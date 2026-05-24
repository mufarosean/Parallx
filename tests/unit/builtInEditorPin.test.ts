/** @vitest-environment jsdom */
/**
 * Pin tests for built-in/editor/main.ts activate() — invariant guards.
 *
 * Pins:
 *   - registers exactly two commands: 'editor.toggleWordWrap' and 'editor.changeEncoding'
 *   - subscriptions length === 2
 *   - changeEncoding handler shows the "not yet implemented" notice
 *   - toggleWordWrap handler does not throw when no active pane is in the DOM
 *   - deactivate() does not throw
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activate, deactivate } from "../../src/built-in/editor/main";

function makeApi() {
  const cmdRegs: Array<{ id: string; handler: (...a: unknown[]) => unknown }> = [];
  const notices: string[] = [];

  const api = {
    commands: {
      registerCommand(id: string, handler: (...a: unknown[]) => unknown) {
        cmdRegs.push({ id, handler });
        return { dispose() {} };
      },
      async executeCommand<T>() { return undefined as unknown as T; },
    },
    editors: {
      async openFileEditor(_uri: string) {},
    },
    window: {
      async showInformationMessage(message: string) {
        notices.push(message);
        return undefined;
      },
    },
  };

  return { api, cmdRegs, notices };
}

function makeContext() {
  return {
    subscriptions: [] as any[],
    workspaceState: { get<T>(_k: string, d: T) { return d; }, update() {} },
  };
}

describe("built-in/editor activate", () => {
  beforeEach(() => {
    deactivate();
    document.body.innerHTML = "";
  });

  it("registers exactly two commands: editor.toggleWordWrap and editor.changeEncoding", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext() as any);
    const ids = cmdRegs.map((r) => r.id).sort();
    expect(ids).toEqual(["editor.changeEncoding", "editor.toggleWordWrap"]);
  });

  it("pushes exactly 2 subscriptions", () => {
    const { api } = makeApi();
    const ctx = makeContext();
    activate(api as any, ctx as any);
    expect(ctx.subscriptions.length).toBe(2);
  });

  it("'editor.changeEncoding' surfaces the not-implemented notice", async () => {
    const { api, cmdRegs, notices } = makeApi();
    activate(api as any, makeContext() as any);
    const cmd = cmdRegs.find((r) => r.id === "editor.changeEncoding")!;
    await cmd.handler();
    expect(notices.length).toBe(1);
    expect(notices[0].toLowerCase()).toContain("not yet implemented");
  });

  it("'editor.toggleWordWrap' does not throw when no active pane exists in the DOM", () => {
    const { api, cmdRegs } = makeApi();
    activate(api as any, makeContext() as any);
    const cmd = cmdRegs.find((r) => r.id === "editor.toggleWordWrap")!;
    expect(() => cmd.handler()).not.toThrow();
  });

  it("deactivate() does not throw and is idempotent", () => {
    expect(() => deactivate()).not.toThrow();
    expect(() => deactivate()).not.toThrow();
  });
});
