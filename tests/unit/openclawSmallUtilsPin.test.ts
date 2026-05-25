/**
 * Pin: small standalone openclaw / services utilities.  Covers four
 * runtime-pure functions in one file:
 *   - resolveModelTier (parameter-size pattern → tier)
 *   - blockReasonFromBoundaryViolation / blockReasonFromPolicyDecision
 *   - tryHandleOpenclawNewCommand
 *   - tryHandleOpenclawThinkCommand
 */
import { describe, it, expect, vi } from "vitest";
import { resolveModelTier } from "../../src/openclaw/openclawModelTier";
import {
  blockReasonFromBoundaryViolation,
  blockReasonFromPolicyDecision,
} from "../../src/services/agentBlockReason";
import { tryHandleOpenclawNewCommand } from "../../src/openclaw/commands/openclawNewCommand";
import {
  tryHandleOpenclawThinkCommand,
  THINK_SESSION_FLAG,
} from "../../src/openclaw/commands/openclawThinkCommand";
import { VERBOSE_SESSION_FLAG } from "../../src/openclaw/commands/openclawVerboseCommand";

describe("resolveModelTier", () => {
  it("returns 'small' for <=8B parameter models", () => {
    expect(resolveModelTier("qwen2.5:7b-instruct")).toBe("small");
    expect(resolveModelTier("llama3:8B")).toBe("small");
    expect(resolveModelTier("foo:1b")).toBe("small");
  });

  it("returns 'medium' for 9B–32B inclusive", () => {
    expect(resolveModelTier("gpt-oss:20b")).toBe("medium");
    expect(resolveModelTier("model:32B")).toBe("medium");
    expect(resolveModelTier("model:9b")).toBe("medium");
  });

  it("returns 'large' for >32B", () => {
    expect(resolveModelTier("llama3:70b")).toBe("large");
    expect(resolveModelTier("massive:405B")).toBe("large");
  });

  it("falls back to 'medium' when no NN[bB] token is present", () => {
    expect(resolveModelTier("claude-opus")).toBe("medium");
    expect(resolveModelTier("")).toBe("medium");
  });
});

describe("blockReasonFromBoundaryViolation", () => {
  it("maps known workspace violation types to 'outside-workspace-request'", () => {
    expect(blockReasonFromBoundaryViolation("outside-workspace")).toBe("outside-workspace-request");
    expect(blockReasonFromBoundaryViolation("no-workspace")).toBe("outside-workspace-request");
    expect(blockReasonFromBoundaryViolation("non-file-uri")).toBe("outside-workspace-request");
  });

  it("falls back to 'policy-denial' for undefined or unknown types", () => {
    expect(blockReasonFromBoundaryViolation(undefined)).toBe("policy-denial");
    expect(blockReasonFromBoundaryViolation("unknown" as any)).toBe("policy-denial");
  });
});

describe("blockReasonFromPolicyDecision", () => {
  it("returns boundary-derived code when first blocked boundary has a violationType", () => {
    const decision = {
      boundaryDecisions: [
        { allowed: true, violationType: undefined },
        { allowed: false, violationType: "outside-workspace" },
        { allowed: false, violationType: "no-workspace" }, // second blocked — ignored
      ],
    } as any;
    expect(blockReasonFromPolicyDecision(decision)).toBe("outside-workspace-request");
  });

  it("returns 'policy-denial' when blocked boundary has undefined violationType", () => {
    const decision = {
      boundaryDecisions: [{ allowed: false, violationType: undefined }],
    } as any;
    expect(blockReasonFromPolicyDecision(decision)).toBe("policy-denial");
  });

  it("returns 'policy-denial' when no boundary is blocked", () => {
    const decision = {
      boundaryDecisions: [{ allowed: true }, { allowed: true }],
    } as any;
    expect(blockReasonFromPolicyDecision(decision)).toBe("policy-denial");
  });
});

describe("tryHandleOpenclawNewCommand", () => {
  function makeResponse() {
    return { markdown: vi.fn(), button: vi.fn(), reference: vi.fn() } as any;
  }

  it("returns false when command is not 'new'", async () => {
    const response = makeResponse();
    expect(await tryHandleOpenclawNewCommand({} as any, "think", response)).toBe(false);
    expect(await tryHandleOpenclawNewCommand({} as any, undefined, response)).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
  });

  it("clears think+verbose session flags and bridges to chat.clearSession when executeCommand exists", async () => {
    const setSessionFlag = vi.fn();
    const executeCommand = vi.fn();
    const response = makeResponse();
    const ok = await tryHandleOpenclawNewCommand(
      { setSessionFlag, executeCommand } as any,
      "new",
      response,
    );
    expect(ok).toBe(true);
    expect(setSessionFlag).toHaveBeenCalledWith(THINK_SESSION_FLAG, false);
    expect(setSessionFlag).toHaveBeenCalledWith(VERBOSE_SESSION_FLAG, false);
    expect(executeCommand).toHaveBeenCalledWith("chat.clearSession");
    expect(response.markdown).toHaveBeenCalledWith("Starting new conversation...");
  });

  it("returns true with warning markdown when executeCommand is missing", async () => {
    const response = makeResponse();
    const ok = await tryHandleOpenclawNewCommand({} as any, "new", response);
    expect(ok).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith(
      "⚠️ New session command is not available in this context.",
    );
  });
});

describe("tryHandleOpenclawThinkCommand", () => {
  function makeResponse() {
    return { markdown: vi.fn() } as any;
  }

  it("returns false when command is not 'think'", async () => {
    const response = makeResponse();
    expect(await tryHandleOpenclawThinkCommand({} as any, "new", response)).toBe(false);
    expect(await tryHandleOpenclawThinkCommand({} as any, undefined, response)).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
  });

  it("toggles flag from false → true and reports thinking-enabled markdown", async () => {
    const flags: Record<string, boolean> = {};
    const services = {
      getSessionFlag: (k: string) => flags[k],
      setSessionFlag: (k: string, v: boolean) => { flags[k] = v; },
    } as any;
    const response = makeResponse();
    const ok = await tryHandleOpenclawThinkCommand(services, "think", response);
    expect(ok).toBe(true);
    expect(flags[THINK_SESSION_FLAG]).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith(
      expect.stringContaining("Thinking mode enabled"),
    );
  });

  it("toggles flag from true → false and reports thinking-disabled markdown", async () => {
    const flags: Record<string, boolean> = { [THINK_SESSION_FLAG]: true };
    const services = {
      getSessionFlag: (k: string) => flags[k],
      setSessionFlag: (k: string, v: boolean) => { flags[k] = v; },
    } as any;
    const response = makeResponse();
    await tryHandleOpenclawThinkCommand(services, "think", response);
    expect(flags[THINK_SESSION_FLAG]).toBe(false);
    expect(response.markdown).toHaveBeenCalledWith(
      expect.stringContaining("Thinking mode disabled"),
    );
  });

  it("treats undefined getSessionFlag as 'currently off' and still toggles via setSessionFlag", async () => {
    const setSessionFlag = vi.fn();
    const response = makeResponse();
    const ok = await tryHandleOpenclawThinkCommand(
      { setSessionFlag } as any,
      "think",
      response,
    );
    expect(ok).toBe(true);
    expect(setSessionFlag).toHaveBeenCalledWith(THINK_SESSION_FLAG, true);
  });

  it("reports unavailable when setSessionFlag is missing", async () => {
    const response = makeResponse();
    const ok = await tryHandleOpenclawThinkCommand({} as any, "think", response);
    expect(ok).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith(
      expect.stringContaining("not available"),
    );
  });
});
