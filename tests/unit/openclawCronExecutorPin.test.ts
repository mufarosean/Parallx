/**
 * Pin: openclawCronExecutor — factories that wire CronService to the
 * SurfaceRouter and the ephemeral-session substrate.  Covers:
 *
 *   - createCronTurnExecutor (thin fallback + real-turn paths,
 *     error/finally semantics, ORIGIN_CRON stamping)
 *   - createCronContextLineFetcher (recent user/assistant pair flattening)
 *   - createCronHeartbeatWaker (HeartbeatRunner adapter)
 */
import { describe, it, expect, vi } from "vitest";
import {
  createCronTurnExecutor,
  createCronContextLineFetcher,
  createCronHeartbeatWaker,
  type ICronChatService,
} from "../../src/openclaw/openclawCronExecutor";
import { ORIGIN_CRON } from "../../src/services/surfaceRouterService";
import {
  SURFACE_STATUS,
  SURFACE_NOTIFICATIONS,
  SURFACE_CHAT,
} from "../../src/openclaw/openclawSurfacePlugin";
import { ChatContentPartKind } from "../../src/services/chatTypes";

function makeRouter() {
  const calls: { delivery: any; origin: string }[] = [];
  return {
    calls,
    router: {
      sendWithOrigin: vi.fn(async (delivery: any, origin: string) => {
        calls.push({ delivery, origin });
      }),
    } as any,
  };
}

function makeJob(over: any = {}) {
  return {
    id: "j1",
    name: "Nightly",
    wakeMode: "active",
    description: "do the thing",
    payload: {},
    ...over,
  };
}

describe("createCronTurnExecutor — thin fallback (no realTurnDeps)", () => {
  it("emits status flash, notification, and idle reset — all ORIGIN_CRON", async () => {
    const { router, calls } = makeRouter();
    const exec = createCronTurnExecutor(router);
    await exec(makeJob() as any, []);

    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.origin === ORIGIN_CRON)).toBe(true);

    expect(calls[0].delivery.surfaceId).toBe(SURFACE_STATUS);
    expect(calls[0].delivery.content).toBe("⏰ cron · Nightly");
    expect(calls[0].delivery.metadata.cronEvent.jobName).toBe("Nightly");

    expect(calls[1].delivery.surfaceId).toBe(SURFACE_NOTIFICATIONS);
    expect(calls[1].delivery.content).toBe(
      'Cron job "Nightly" fired — do the thing',
    );
    expect(calls[1].delivery.metadata.severity).toBe("info");
    expect(calls[1].delivery.metadata.source).toBe("cron");

    expect(calls[2].delivery.surfaceId).toBe(SURFACE_STATUS);
    expect(calls[2].delivery.content).toBe(""); // idle reset
    expect(calls[2].delivery.metadata.cronEvent.phase).toBe("idle");
  });

  it("notification text omits dash when description is absent/blank", async () => {
    const { router, calls } = makeRouter();
    const exec = createCronTurnExecutor(router);
    await exec(makeJob({ description: "" }) as any, []);
    expect(calls[1].delivery.content).toBe('Cron job "Nightly" fired');
  });
});

describe("createCronTurnExecutor — thin fallback when realTurnDeps present but parent missing", () => {
  it("logs and falls back to notification when getParentSessionId() returns undefined", async () => {
    const { router, calls } = makeRouter();
    const chatService: ICronChatService = {
      createEphemeralSession: vi.fn() as any,
      purgeEphemeralSession: vi.fn() as any,
      sendRequest: vi.fn() as any,
      getSession: vi.fn() as any,
    };
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const exec = createCronTurnExecutor(router, {
      chatService,
      getParentSessionId: () => undefined,
    });
    await exec(makeJob({ payload: { agentTurn: "do x" } }) as any, []);
    expect(chatService.createEphemeralSession).not.toHaveBeenCalled();
    expect(calls.map((c) => c.delivery.surfaceId)).toEqual([
      SURFACE_STATUS,
      SURFACE_NOTIFICATIONS,
      SURFACE_STATUS,
    ]);
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});

describe("createCronTurnExecutor — real-turn happy path", () => {
  it("creates ephemeral session, sends request, delivers chat result, purges in finally", async () => {
    const { router, calls } = makeRouter();
    const handle = { sessionId: "eph-1" } as any;
    const createEphemeralSession = vi.fn(() => handle);
    const purgeEphemeralSession = vi.fn();
    const sendRequest = vi.fn(async () => {});
    const getSession = vi.fn(() => ({
      messages: [
        {
          response: {
            parts: [
              { kind: ChatContentPartKind.Markdown, content: "Result body" },
            ],
          },
        },
      ],
    }));
    const exec = createCronTurnExecutor(router, {
      chatService: { createEphemeralSession, purgeEphemeralSession, sendRequest, getSession } as any,
      getParentSessionId: () => "parent-1",
    });

    await exec(makeJob({ payload: { agentTurn: "  do x  " } }) as any, ["user: hi", "assistant: ok"]);

    expect(createEphemeralSession).toHaveBeenCalledWith(
      "parent-1",
      expect.objectContaining({
        systemMessage: expect.stringContaining('scheduled cron job "Nightly"'),
        firstUserMessage: expect.stringContaining("Task: do x"),
      }),
    );
    // user message includes context block when contextLines is non-empty
    const seed = createEphemeralSession.mock.calls[0][1] as any;
    expect(seed.firstUserMessage).toContain("Previous chat context:");
    expect(seed.firstUserMessage).toContain("user: hi");
    expect(seed.firstUserMessage).toContain("assistant: ok");

    expect(sendRequest).toHaveBeenCalledWith("eph-1", seed.firstUserMessage);
    expect(purgeEphemeralSession).toHaveBeenCalledWith(handle);

    // Surface order: STATUS (start), CHAT (result), STATUS (idle reset).
    expect(calls.map((c) => c.delivery.surfaceId)).toEqual([
      SURFACE_STATUS,
      SURFACE_CHAT,
      SURFACE_STATUS,
    ]);
    const chatCall = calls[1].delivery;
    expect(chatCall.content).toBe("Result body");
    expect(chatCall.metadata.cronResult).toBe(true);
    expect(chatCall.metadata.jobId).toBe("j1");
    expect(chatCall.metadata.parentSessionId).toBe("parent-1");
    expect(chatCall.metadata.error).toBeUndefined();
  });

  it("omits chat result card when assistant text is blank", async () => {
    const { router, calls } = makeRouter();
    const exec = createCronTurnExecutor(router, {
      chatService: {
        createEphemeralSession: () => ({ sessionId: "x" }) as any,
        purgeEphemeralSession: () => {},
        sendRequest: async () => {},
        getSession: () => ({ messages: [{ response: { parts: [] } }] }),
      } as any,
      getParentSessionId: () => "p",
    });
    await exec(makeJob({ payload: { agentTurn: "x" } }) as any, []);
    expect(calls.map((c) => c.delivery.surfaceId)).toEqual([
      SURFACE_STATUS,
      SURFACE_STATUS, // straight to idle reset
    ]);
  });

  it("when contextLines empty: user seed omits 'Previous chat context:' block", async () => {
    let capturedSeed: any;
    const exec = createCronTurnExecutor(makeRouter().router, {
      chatService: {
        createEphemeralSession: (_p: string, s: any) => { capturedSeed = s; return { sessionId: "x" }; },
        purgeEphemeralSession: () => {},
        sendRequest: async () => {},
        getSession: () => undefined,
      } as any,
      getParentSessionId: () => "p",
    });
    await exec(makeJob({ payload: { agentTurn: "doit" } }) as any, []);
    expect(capturedSeed.firstUserMessage).toBe("Task: doit");
    expect(capturedSeed.firstUserMessage).not.toContain("Previous chat context");
  });
});

describe("createCronTurnExecutor — real-turn error handling", () => {
  it("delivers error chat card, purges, rethrows", async () => {
    const { router, calls } = makeRouter();
    const purge = vi.fn();
    const exec = createCronTurnExecutor(router, {
      chatService: {
        createEphemeralSession: () => ({ sessionId: "x" }) as any,
        purgeEphemeralSession: purge,
        sendRequest: async () => { throw new Error("boom"); },
        getSession: () => undefined,
      } as any,
      getParentSessionId: () => "p",
    });
    await expect(exec(makeJob({ payload: { agentTurn: "x" } }) as any, [])).rejects.toThrow("boom");
    expect(purge).toHaveBeenCalled();

    const chatCall = calls.find((c) => c.delivery.surfaceId === SURFACE_CHAT)!;
    expect(chatCall.delivery.content).toBe("Cron turn error: boom");
    expect(chatCall.delivery.metadata.error).toBe(true);
    expect(chatCall.delivery.metadata.cronResult).toBe(true);
  });

  it("wraps non-Error throws as Error on rethrow", async () => {
    const exec = createCronTurnExecutor(makeRouter().router, {
      chatService: {
        createEphemeralSession: () => ({ sessionId: "x" }) as any,
        purgeEphemeralSession: () => {},
        sendRequest: async () => { throw "stringy"; },
        getSession: () => undefined,
      } as any,
      getParentSessionId: () => "p",
    });
    await expect(exec(makeJob({ payload: { agentTurn: "x" } }) as any, [])).rejects.toThrowError(
      new Error("stringy"),
    );
  });
});

describe("createCronContextLineFetcher", () => {
  it("returns [] when count <= 0", async () => {
    const fetch = createCronContextLineFetcher({
      getActiveSession: () => ({ messages: [] }) as any,
    });
    expect(await fetch(0)).toEqual([]);
    expect(await fetch(-1)).toEqual([]);
  });

  it("returns [] when no active session", async () => {
    const fetch = createCronContextLineFetcher({
      getActiveSession: () => undefined,
    });
    expect(await fetch(5)).toEqual([]);
  });

  it("flattens last N pairs to 'user: <text>' + 'assistant: <markdown>' lines", async () => {
    const fetch = createCronContextLineFetcher({
      getActiveSession: () => ({
        messages: [
          { request: { text: "first" }, response: { parts: [{ kind: ChatContentPartKind.Markdown, content: "A" }] } },
          { request: { text: "  second  " }, response: { parts: [{ kind: ChatContentPartKind.Markdown, content: "B" }] } },
          { request: { text: "third" }, response: { parts: [
            { kind: ChatContentPartKind.ToolInvocation, content: "ignored" },
            { kind: ChatContentPartKind.Markdown, content: "C" },
          ] } },
        ],
      }) as any,
    });
    expect(await fetch(2)).toEqual([
      "user: second",
      "assistant: B",
      "user: third",
      "assistant: C",
    ]);
  });

  it("skips blank user/assistant text without emitting empty entries", async () => {
    const fetch = createCronContextLineFetcher({
      getActiveSession: () => ({
        messages: [
          { request: { text: "  " }, response: { parts: [] } },
          { request: { text: "hi" }, response: { parts: [{ kind: ChatContentPartKind.Progress, content: "x" }] } },
        ],
      }) as any,
    });
    expect(await fetch(5)).toEqual(["user: hi"]);
  });
});

describe("createCronHeartbeatWaker", () => {
  it("forwards wake('cron') to the runner.wake method", () => {
    const wake = vi.fn();
    const runner = { wake } as any;
    const waker = createCronHeartbeatWaker(runner);
    waker("cron");
    expect(wake).toHaveBeenCalledWith("cron");
  });
});
