/**
 * Pin-the-invariant: tools/terminalTools — run_command guards + execution.
 */
import { describe, it, expect, vi } from "vitest";
import { createRunCommandTool } from "../../src/built-in/chat/tools/terminalTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("run_command tool", () => {
  it("declares stable name + approval policy", () => {
    const t = createRunCommandTool(undefined);
    expect(t.name).toBe("run_command");
    expect(t.requiresConfirmation).toBe(true);
    expect(t.permissionLevel).toBe("requires-approval");
    expect(t.parameters.required).toEqual(["command"]);
  });

  it("errors when terminal is undefined", async () => {
    const t = createRunCommandTool(undefined);
    const r = await t.handler({ command: "echo" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Terminal is not available");
  });

  it("errors on empty command", async () => {
    const t = createRunCommandTool({ exec: vi.fn() } as any);
    const r = await t.handler({ command: "  " }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toBe("command is required");
  });

  it("blocks dangerous prefixes", async () => {
    const exec = vi.fn();
    const t = createRunCommandTool({ exec } as any);
    for (const cmd of ["rm -rf /", "shutdown now", "mkfs.ext4 /dev/sda", "format C:"]) {
      const r = await t.handler({ command: cmd }, token);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("blocked for safety");
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it("blocks the fork-bomb substring", async () => {
    const t = createRunCommandTool({ exec: vi.fn() } as any);
    const r = await t.handler({ command: ":(){:|:&};:" }, token);
    expect(r.isError).toBe(true);
  });

  it("forwards command + cwd + timeout to terminal", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, error: null });
    const t = createRunCommandTool({ exec } as any, "C:/ws");
    await t.handler({ command: "echo hi", timeout: 5000 }, token);
    expect(exec).toHaveBeenCalledWith("echo hi", { cwd: "C:/ws", timeout: 5000 });
  });

  it("uses default 30000ms timeout when omitted", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, error: null });
    const t = createRunCommandTool({ exec } as any);
    await t.handler({ command: "echo" }, token);
    expect(exec.mock.calls[0][1].timeout).toBe(30000);
  });

  it("reports successful output", async () => {
    const t = createRunCommandTool({
      exec: vi.fn().mockResolvedValue({ stdout: "hi", stderr: "", exitCode: 0, error: null }),
    } as any);
    const r = await t.handler({ command: "echo hi" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("$ echo hi");
    expect(r.content).toContain("hi");
  });

  it("includes exit code suffix when non-zero, joins streams when both present", async () => {
    const t = createRunCommandTool({
      exec: vi.fn().mockResolvedValue({ stdout: "out", stderr: "boom", exitCode: 2, error: null }),
    } as any);
    const r = await t.handler({ command: "fail" }, token);
    expect(r.content).toContain("(exit code: 2)");
    expect(r.content).toContain("[stderr]");
    expect(r.content).toContain("boom");
  });

  it("surfaces exec error result.error path", async () => {
    const t = createRunCommandTool({
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: -1, error: { message: "spawn fail" } }),
    } as any);
    const r = await t.handler({ command: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Command error: spawn fail");
  });

  it("substitutes '(no output)' when both streams empty", async () => {
    const t = createRunCommandTool({
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, error: null }),
    } as any);
    const r = await t.handler({ command: "silent" }, token);
    expect(r.content).toContain("(no output)");
  });

  it("truncates output beyond 50_000 chars", async () => {
    const huge = "x".repeat(60_000);
    const t = createRunCommandTool({
      exec: vi.fn().mockResolvedValue({ stdout: huge, stderr: "", exitCode: 0, error: null }),
    } as any);
    const r = await t.handler({ command: "x" }, token);
    expect(r.content).toContain("truncated");
  });
});
