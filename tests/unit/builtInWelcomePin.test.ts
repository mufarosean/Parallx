/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/welcome/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - registers one editor provider with typeId='parallx.welcome.editor'
 *   - registers four commands: welcome.openWelcome, parallx.chat.openWithInit,
 *     parallx.openAIUserGuide, parallx.openWorkspaceAIConfig
 *   - reads & writes globalState['welcome.hasShownWelcome']:
 *     - if unset → auto-opens welcome editor and writes true
 *     - if true → does NOT auto-open
 *   - subscriptions length === 5 (editor + 4 commands)
 *   - services.get failures are swallowed (no throw if storage services missing)
 *   - command `welcome.openWelcome` calls editors.openEditor with title='Welcome'
 *     and typeId='parallx.welcome.editor'
 *   - createEditorPane returns IDisposable that removes the wrapper from container
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activate, deactivate } from "../../src/built-in/welcome/main";

function makeApi() {
  const editorRegs: Array<{ typeId: string; provider: any }> = [];
  const openCalls: Array<{ typeId: string; title: string; icon?: string }> = [];
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];
  const execCalls: Array<{ id: string; args: unknown[] }> = [];

  const api = {
    editors: {
      registerEditorProvider(typeId: string, provider: any) {
        editorRegs.push({ typeId, provider });
        return { dispose() {} };
      },
      async openEditor(options: any) {
        openCalls.push(options);
      },
    },
    commands: {
      registerCommand(id: string, handler: (...a: unknown[]) => unknown) {
        cmdRegs.push({ id, handler });
        return { dispose() {} };
      },
      async executeCommand(id: string, ...args: unknown[]) {
        execCalls.push({ id, args });
        return undefined;
      },
    },
    env: { appName: "Parallx", appVersion: "0.1.0" },
    services: {
      get<T>(_id: any): T {
        throw new Error("not registered");
      },
      has(_id: any) {
        return false;
      },
    },
  };

  return { api, editorRegs, openCalls, cmdRegs, execCalls };
}

function makeContext(globalInitial: Record<string, unknown> = {}) {
  const gState: Record<string, unknown> = { ...globalInitial };
  const wState: Record<string, unknown> = {};
  const gUpdates: Array<{ key: string; value: unknown }> = [];
  return {
    subscriptions: [] as any[],
    globalState: {
      get<T>(k: string): T | undefined { return gState[k] as T | undefined; },
      update(k: string, v: unknown) { gState[k] = v; gUpdates.push({ key: k, value: v }); },
    },
    workspaceState: {
      get<T>(k: string): T | undefined { return wState[k] as T | undefined; },
      update(k: string, v: unknown) { wState[k] = v; },
    },
    toolPath: "/tmp/welcome",
    toolUri: "file:///tmp/welcome",
    environmentVariableCollection: {},
    _gUpdates: gUpdates,
  } as any;
}

describe("built-in/welcome activate — registrations", () => {
  beforeEach(() => deactivate());

  it("registers exactly one editor provider with typeId='parallx.welcome.editor'", () => {
    const { api, editorRegs } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    expect(editorRegs.length).toBe(1);
    expect(editorRegs[0].typeId).toBe("parallx.welcome.editor");
  });

  it("registers the four expected commands", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    const ids = cmdRegs.map((r) => r.id);
    expect(ids).toContain("welcome.openWelcome");
    expect(ids).toContain("parallx.chat.openWithInit");
    expect(ids).toContain("parallx.openAIUserGuide");
    expect(ids).toContain("parallx.openWorkspaceAIConfig");
  });

  it("pushes exactly 5 subscriptions (editor + 4 commands)", () => {
    const { api } = makeApi();
    const ctx = makeContext({ "welcome.hasShownWelcome": true });
    activate(api as any, ctx);
    expect(ctx.subscriptions.length).toBe(5);
  });

  it("does NOT throw when storage services are not registered", () => {
    const { api } = makeApi();
    expect(() => activate(api as any, makeContext({ "welcome.hasShownWelcome": true }))).not.toThrow();
  });
});

describe("built-in/welcome — first-launch behavior", () => {
  beforeEach(() => deactivate());

  it("auto-opens welcome editor and sets globalState flag on first launch", () => {
    const { api, openCalls } = makeApi();
    const ctx = makeContext({}); // unset
    activate(api as any, ctx);
    expect(openCalls.length).toBe(1);
    expect(openCalls[0].typeId).toBe("parallx.welcome.editor");
    expect(openCalls[0].title).toBe("Welcome");
    expect(ctx._gUpdates).toContainEqual({ key: "welcome.hasShownWelcome", value: true });
  });

  it("does NOT auto-open when globalState flag is already true", () => {
    const { api, openCalls } = makeApi();
    const ctx = makeContext({ "welcome.hasShownWelcome": true });
    activate(api as any, ctx);
    expect(openCalls.length).toBe(0);
    expect(ctx._gUpdates.length).toBe(0);
  });
});

describe("built-in/welcome — command handlers", () => {
  beforeEach(() => deactivate());

  it("welcome.openWelcome invokes editors.openEditor with the welcome editor type/title", () => {
    const { api, cmdRegs, openCalls } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    openCalls.length = 0;

    const cmd = cmdRegs.find((r) => r.id === "welcome.openWelcome")!;
    cmd.handler();

    expect(openCalls.length).toBe(1);
    expect(openCalls[0].typeId).toBe("parallx.welcome.editor");
    expect(openCalls[0].title).toBe("Welcome");
  });

  it("parallx.chat.openWithInit executes chat.open then chat.insertText with '/init '", async () => {
    const { api, cmdRegs, execCalls } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    execCalls.length = 0;

    const cmd = cmdRegs.find((r) => r.id === "parallx.chat.openWithInit")!;
    await cmd.handler();

    const ids = execCalls.map((c) => c.id);
    expect(ids).toEqual([
      "workbench.action.chat.open",
      "workbench.action.chat.insertText",
    ]);
    expect(execCalls[1].args[0]).toBe("/init ");
  });

  it("parallx.openAIUserGuide opens the AI user guide via quickOpen", () => {
    const { api, cmdRegs, execCalls } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    execCalls.length = 0;

    const cmd = cmdRegs.find((r) => r.id === "parallx.openAIUserGuide")!;
    cmd.handler();

    expect(execCalls.length).toBe(1);
    expect(execCalls[0].id).toBe("workbench.action.quickOpen");
    expect(String(execCalls[0].args[0])).toContain("AI_USER_GUIDE");
  });

  it("parallx.openWorkspaceAIConfig opens the .parallx/ai-config.json via quickOpen", () => {
    const { api, cmdRegs, execCalls } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));
    execCalls.length = 0;

    const cmd = cmdRegs.find((r) => r.id === "parallx.openWorkspaceAIConfig")!;
    cmd.handler();

    expect(execCalls.length).toBe(1);
    expect(execCalls[0].id).toBe("workbench.action.quickOpen");
    expect(String(execCalls[0].args[0])).toBe(".parallx/ai-config.json");
  });
});

describe("built-in/welcome — editor pane rendering", () => {
  beforeEach(() => deactivate());

  it("createEditorPane attaches welcome wrapper and returns disposable that removes it", () => {
    const { api, editorRegs } = makeApi();
    activate(api as any, makeContext({ "welcome.hasShownWelcome": true }));

    const container = document.createElement("div");
    const pane = editorRegs[0].provider.createEditorPane(container);

    expect(container.classList.contains("welcome-container")).toBe(true);
    const wrapper = container.querySelector(".welcome-wrapper");
    expect(wrapper).toBeTruthy();

    pane.dispose();
    expect(container.querySelector(".welcome-wrapper")).toBeNull();
  });
});
