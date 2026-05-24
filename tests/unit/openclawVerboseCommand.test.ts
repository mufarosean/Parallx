import { describe, it, expect, vi } from "vitest";
import {
  VERBOSE_SESSION_FLAG,
  tryHandleOpenclawVerboseCommand,
} from "../../src/openclaw/commands/openclawVerboseCommand";

function makeResponse() {
  const calls: string[] = [];
  return {
    response: { markdown: (s: string) => calls.push(s) } as any,
    calls,
  };
}

describe("tryHandleOpenclawVerboseCommand", () => {
  it("returns false and does not touch services for non-'verbose' commands", async () => {
    const r = makeResponse();
    const services: any = {
      getSessionFlag: vi.fn(),
      setSessionFlag: vi.fn(),
    };
    expect(await tryHandleOpenclawVerboseCommand(services, "other", r.response)).toBe(false);
    expect(await tryHandleOpenclawVerboseCommand(services, undefined, r.response)).toBe(false);
    expect(services.getSessionFlag).not.toHaveBeenCalled();
    expect(services.setSessionFlag).not.toHaveBeenCalled();
    expect(r.calls).toEqual([]);
  });

  it("toggles from undefined → true and writes enabled-mode markdown", async () => {
    const r = makeResponse();
    const services: any = {
      getSessionFlag: vi.fn().mockReturnValue(undefined),
      setSessionFlag: vi.fn(),
    };
    const handled = await tryHandleOpenclawVerboseCommand(services, "verbose", r.response);
    expect(handled).toBe(true);
    expect(services.setSessionFlag).toHaveBeenCalledWith(VERBOSE_SESSION_FLAG, true);
    expect(r.calls[0]).toContain("Verbose mode enabled");
  });

  it("toggles from true → false and writes disabled-mode markdown", async () => {
    const r = makeResponse();
    const services: any = {
      getSessionFlag: vi.fn().mockReturnValue(true),
      setSessionFlag: vi.fn(),
    };
    const handled = await tryHandleOpenclawVerboseCommand(services, "verbose", r.response);
    expect(handled).toBe(true);
    expect(services.setSessionFlag).toHaveBeenCalledWith(VERBOSE_SESSION_FLAG, false);
    expect(r.calls[0]).toContain("Verbose mode disabled");
  });

  it("when setSessionFlag is missing it emits the storage-unavailable warning instead of toggling", async () => {
    const r = makeResponse();
    const services: any = {
      getSessionFlag: vi.fn().mockReturnValue(false),
      // no setSessionFlag
    };
    const handled = await tryHandleOpenclawVerboseCommand(services, "verbose", r.response);
    expect(handled).toBe(true);
    expect(r.calls[0]).toContain("Session flag storage is not available");
  });

  it("uses session flag key 'openclaw.verboseEnabled'", () => {
    expect(VERBOSE_SESSION_FLAG).toBe("openclaw.verboseEnabled");
  });
});
