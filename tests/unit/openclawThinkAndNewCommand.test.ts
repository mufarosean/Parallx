import { describe, it, expect, vi } from "vitest";
import {
  THINK_SESSION_FLAG,
  tryHandleOpenclawThinkCommand,
} from "../../src/openclaw/commands/openclawThinkCommand";
import { tryHandleOpenclawNewCommand } from "../../src/openclaw/commands/openclawNewCommand";
import { VERBOSE_SESSION_FLAG } from "../../src/openclaw/commands/openclawVerboseCommand";

function makeResponse() {
  const calls: string[] = [];
  return { response: { markdown: (s: string) => calls.push(s) } as any, calls };
}

describe("tryHandleOpenclawThinkCommand", () => {
  it("session flag key is 'openclaw.thinkingEnabled'", () => {
    expect(THINK_SESSION_FLAG).toBe("openclaw.thinkingEnabled");
  });

  it("returns false for non-'think' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawThinkCommand({} as any, "other", r.response)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("toggles undefined → true with enabled markdown", async () => {
    const r = makeResponse();
    const services: any = { setSessionFlag: vi.fn() };
    await tryHandleOpenclawThinkCommand(services, "think", r.response);
    expect(services.setSessionFlag).toHaveBeenCalledWith(THINK_SESSION_FLAG, true);
    expect(r.calls[0]).toContain("Thinking mode enabled");
  });

  it("toggles true → false with disabled markdown", async () => {
    const r = makeResponse();
    const services: any = {
      getSessionFlag: vi.fn().mockReturnValue(true),
      setSessionFlag: vi.fn(),
    };
    await tryHandleOpenclawThinkCommand(services, "think", r.response);
    expect(services.setSessionFlag).toHaveBeenCalledWith(THINK_SESSION_FLAG, false);
    expect(r.calls[0]).toContain("Thinking mode disabled");
  });

  it("emits storage-unavailable warning when setSessionFlag missing", async () => {
    const r = makeResponse();
    const handled = await tryHandleOpenclawThinkCommand({} as any, "think", r.response);
    expect(handled).toBe(true);
    expect(r.calls[0]).toContain("Session flag storage is not available");
  });
});

describe("tryHandleOpenclawNewCommand", () => {
  it("returns false for non-'new' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawNewCommand({} as any, "x", r.response)).toBe(false);
  });

  it("clears think + verbose session flags then dispatches chat.clearSession", async () => {
    const r = makeResponse();
    const services: any = {
      setSessionFlag: vi.fn(),
      executeCommand: vi.fn(),
    };
    const handled = await tryHandleOpenclawNewCommand(services, "new", r.response);
    expect(handled).toBe(true);
    expect(services.setSessionFlag).toHaveBeenCalledWith(THINK_SESSION_FLAG, false);
    expect(services.setSessionFlag).toHaveBeenCalledWith(VERBOSE_SESSION_FLAG, false);
    expect(services.executeCommand).toHaveBeenCalledWith("chat.clearSession");
    expect(r.calls[0]).toContain("Starting new conversation");
  });

  it("warns when executeCommand is unavailable instead of crashing", async () => {
    const r = makeResponse();
    const services: any = { setSessionFlag: vi.fn() };
    const handled = await tryHandleOpenclawNewCommand(services, "new", r.response);
    expect(handled).toBe(true);
    expect(r.calls[0]).toContain("not available in this context");
  });
});
