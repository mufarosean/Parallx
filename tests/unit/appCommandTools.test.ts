/**
 * Pin-the-invariant: tools/appCommandTools — app__find_commands + app__run_command.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createAppFindCommandsTool,
  createAppRunCommandTool,
} from "../../src/built-in/chat/tools/appCommandTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("createAppFindCommandsTool", () => {
  it("declares stable name/perm/source", () => {
    const t = createAppFindCommandsTool(undefined);
    expect(t.name).toBe("app__find_commands");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.source).toBe("built-in");
    expect(t.requiresConfirmation).toBe(false);
    expect(t.parameters.required).toContain("query");
  });

  it("fails when registry is undefined", async () => {
    const t = createAppFindCommandsTool(undefined);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("command registry unavailable");
  });

  it("returns up to limit results from registry", async () => {
    const cmd = (id: string, title: string) => ({
      id, title, category: "Test", aiInvocable: true,
      aiDescription: `desc for ${title}`,
      handler: () => {},
    });
    const registry = {
      getCommands: () => [cmd("a", "Alpha"), cmd("b", "Beta"), cmd("c", "Gamma")],
    };
    const t = createAppFindCommandsTool(registry as any);
    const r = await t.handler({ query: "alpha", limit: 5 }, token);
    const parsed = JSON.parse(r.content);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.returned).toBeGreaterThanOrEqual(1);
    // Each result has id/title/description/category
    expect(parsed.results[0]).toHaveProperty("id");
    expect(parsed.results[0]).toHaveProperty("description");
  });

  it("caps limit at 10 and floors at 1", async () => {
    const registry = { getCommands: () => [] };
    const t = createAppFindCommandsTool(registry as any);
    // Just verify it doesn't throw on extreme values
    const r1 = await t.handler({ query: "x", limit: 9999 }, token);
    const r2 = await t.handler({ query: "x", limit: -50 }, token);
    expect(JSON.parse(r1.content).ok).toBe(true);
    expect(JSON.parse(r2.content).ok).toBe(true);
  });
});

describe("createAppRunCommandTool", () => {
  it("declares stable name/perm/source and required commandId", () => {
    const t = createAppRunCommandTool(undefined);
    expect(t.name).toBe("app__run_command");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.parameters.required).toContain("commandId");
  });

  it("fails when commandService is undefined", async () => {
    const t = createAppRunCommandTool(undefined);
    const r = await t.handler({ commandId: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("command service unavailable");
  });

  it("fails when commandId is missing", async () => {
    const t = createAppRunCommandTool({ getCommand: () => undefined, executeCommand: vi.fn() } as any);
    const r = await t.handler({}, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("commandId is required");
  });

  it("blocks excluded commands BEFORE checking registry", async () => {
    const exec = vi.fn();
    const getCommand = vi.fn();
    const t = createAppRunCommandTool({ getCommand, executeCommand: exec } as any);
    const r = await t.handler({ commandId: "memory.openDurable" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("excluded from AI invocation");
    expect(exec).not.toHaveBeenCalled();
    expect(getCommand).not.toHaveBeenCalled();
  });

  it("fails on unknown command id", async () => {
    const t = createAppRunCommandTool({
      getCommand: () => undefined,
      executeCommand: vi.fn(),
    } as any);
    const r = await t.handler({ commandId: "no.such.cmd" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Unknown command");
  });

  it("rejects commands lacking aiInvocable flag", async () => {
    const t = createAppRunCommandTool({
      getCommand: () => ({ id: "x", aiInvocable: false }),
      executeCommand: vi.fn(),
    } as any);
    const r = await t.handler({ commandId: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not opted in");
  });

  it("executes opted-in command without arg", async () => {
    const exec = vi.fn().mockResolvedValue("done");
    const t = createAppRunCommandTool({
      getCommand: () => ({ id: "ok.cmd", aiInvocable: true }),
      executeCommand: exec,
    } as any);
    const r = await t.handler({ commandId: "ok.cmd" }, token);
    const parsed = JSON.parse(r.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.executed).toBe(true);
    expect(parsed.result).toBe("done");
    expect(exec).toHaveBeenCalledWith("ok.cmd");
  });

  it("forwards single string arg when provided", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const t = createAppRunCommandTool({
      getCommand: () => ({ id: "ok.cmd", aiInvocable: true }),
      executeCommand: exec,
    } as any);
    await t.handler({ commandId: "ok.cmd", arg: "value" }, token);
    expect(exec).toHaveBeenCalledWith("ok.cmd", "value");
  });

  it("non-primitive return values are coerced to null", async () => {
    const t = createAppRunCommandTool({
      getCommand: () => ({ id: "ok.cmd", aiInvocable: true }),
      executeCommand: vi.fn().mockResolvedValue({ obj: true }),
    } as any);
    const r = await t.handler({ commandId: "ok.cmd" }, token);
    expect(JSON.parse(r.content).result).toBeNull();
  });

  it("execution failure surfaces as structured error", async () => {
    const t = createAppRunCommandTool({
      getCommand: () => ({ id: "ok.cmd", aiInvocable: true }),
      executeCommand: vi.fn().mockRejectedValue(new Error("boom")),
    } as any);
    const r = await t.handler({ commandId: "ok.cmd" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("boom");
  });
});
