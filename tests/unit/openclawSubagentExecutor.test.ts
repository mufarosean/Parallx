import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractFinalAssistantText,
  createSubagentTurnExecutor,
  createSubagentAnnouncer,
  currentSubagentDepth,
  _resetSubagentDepthForTests,
  type ISubagentChatService,
  type ISubagentAnnouncerRouter,
} from "../../src/openclaw/openclawSubagentExecutor";
import { ORIGIN_SUBAGENT } from "../../src/services/surfaceRouterService";
import { SURFACE_CHAT } from "../../src/openclaw/openclawSurfacePlugin";

describe("extractFinalAssistantText", () => {
  it("returns empty string for empty parts", () => {
    expect(extractFinalAssistantText([])).toBe("");
  });

  it("joins content/code/message fields with newlines and trims", () => {
    const parts = [
      { content: "  hello " },
      { code: "console.log(1)" },
      { message: "done." },
    ];
    expect(extractFinalAssistantText(parts as never)).toBe(
      "hello \nconsole.log(1)\ndone.",
    );
  });

  it("ignores parts that have none of content/code/message", () => {
    const parts = [
      { kind: "image", uri: "x" },
      { content: "kept" },
    ];
    expect(extractFinalAssistantText(parts as never)).toBe("kept");
  });

  it("prefers 'content' over 'code'/'message' when both present", () => {
    expect(
      extractFinalAssistantText([
        { content: "from-content", code: "ignored" },
      ] as never),
    ).toBe("from-content");
  });
});

describe("createSubagentTurnExecutor — happy path", () => {
  beforeEach(() => _resetSubagentDepthForTests());

  it("throws when there is no active parent session", async () => {
    const exec = createSubagentTurnExecutor({
      chatService: {} as ISubagentChatService,
      getParentSessionId: () => undefined,
    });
    await expect(exec("task", null)).rejects.toThrow(/no active parent session/);
  });

  it("creates ephemeral session, sends request, returns extracted text, purges", async () => {
    const handle = { sessionId: "eph-1" } as never;
    const create = vi.fn().mockReturnValue(handle);
    const purge = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const getSession = vi.fn().mockReturnValue({
      messages: [
        { response: { parts: [{ content: "noisy" }] } },
        { response: { parts: [{ content: "final answer " }] } },
      ],
    });
    const chatService: ISubagentChatService = {
      createEphemeralSession: create,
      purgeEphemeralSession: purge,
      sendRequest: send,
      getSession,
    };
    const exec = createSubagentTurnExecutor({
      chatService,
      getParentSessionId: () => "parent",
    });
    const out = await exec("do thing", "model-x");
    expect(out).toBe("final answer");
    expect(create).toHaveBeenCalledWith("parent", { firstUserMessage: "do thing" });
    expect(send).toHaveBeenCalledWith("eph-1", "do thing", undefined);
    expect(purge).toHaveBeenCalledWith(handle);
    // Depth restored.
    expect(currentSubagentDepth()).toBe(0);
  });

  it("returns empty string when ephemeral session has no messages", async () => {
    const handle = { sessionId: "e" } as never;
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: () => {},
        sendRequest: async () => {},
        getSession: () => ({ messages: [] }),
      },
      getParentSessionId: () => "p",
    });
    expect(await exec("t", null)).toBe("");
  });

  it("returns empty string when getSession returns undefined", async () => {
    const handle = { sessionId: "e" } as never;
    const purge = vi.fn();
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: purge,
        sendRequest: async () => {},
        getSession: () => undefined,
      },
      getParentSessionId: () => "p",
    });
    expect(await exec("t", null)).toBe("");
    expect(purge).toHaveBeenCalledWith(handle);
  });

  it("passes buildSendOptions output to sendRequest verbatim", async () => {
    const handle = { sessionId: "e" } as never;
    const send = vi.fn().mockResolvedValue(undefined);
    const opts = { temperature: 0.1 } as never;
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: () => {},
        sendRequest: send,
        getSession: () => ({ messages: [] }),
      },
      getParentSessionId: () => "p",
      buildSendOptions: (task, model) => {
        expect(task).toBe("task");
        expect(model).toBe("m1");
        return opts;
      },
    });
    await exec("task", "m1");
    expect(send).toHaveBeenCalledWith("e", "task", opts);
  });
});

describe("createSubagentTurnExecutor — depth + permission marking", () => {
  beforeEach(() => _resetSubagentDepthForTests());

  it("increments depth during sendRequest and decrements on completion", async () => {
    const handle = { sessionId: "e" } as never;
    let observedDepth = -1;
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: () => {},
        sendRequest: async () => {
          observedDepth = currentSubagentDepth();
        },
        getSession: () => ({ messages: [] }),
      },
      getParentSessionId: () => "p",
    });
    expect(currentSubagentDepth()).toBe(0);
    await exec("t", null);
    expect(observedDepth).toBe(1);
    expect(currentSubagentDepth()).toBe(0);
  });

  it("decrements depth and purges even when sendRequest rejects", async () => {
    const handle = { sessionId: "e" } as never;
    const purge = vi.fn();
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: purge,
        sendRequest: async () => { throw new Error("boom"); },
        getSession: () => undefined,
      },
      getParentSessionId: () => "p",
    });
    await expect(exec("t", null)).rejects.toThrow("boom");
    expect(currentSubagentDepth()).toBe(0);
    expect(purge).toHaveBeenCalledWith(handle);
  });

  it("marks and unmarks the subagent session via permissionService when provided", async () => {
    const handle = { sessionId: "subsess" } as never;
    const mark = vi.fn();
    const unmark = vi.fn();
    const autonomy = "auto" as never;
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: () => {},
        sendRequest: async () => {},
        getSession: () => ({ messages: [] }),
      },
      getParentSessionId: () => "p",
      permissionService: { markSubagentSession: mark, unmarkSubagentSession: unmark },
      getAutonomyLevel: () => autonomy,
    });
    await exec("t", null);
    expect(mark).toHaveBeenCalledWith("subsess", autonomy);
    expect(unmark).toHaveBeenCalledWith("subsess");
  });

  it("unmark still runs when sendRequest throws", async () => {
    const handle = { sessionId: "subsess" } as never;
    const unmark = vi.fn();
    const exec = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: () => handle,
        purgeEphemeralSession: () => {},
        sendRequest: async () => { throw new Error("x"); },
        getSession: () => undefined,
      },
      getParentSessionId: () => "p",
      permissionService: {
        markSubagentSession: () => {},
        unmarkSubagentSession: unmark,
      },
    });
    await expect(exec("t", null)).rejects.toThrow("x");
    expect(unmark).toHaveBeenCalledWith("subsess");
  });
});

describe("createSubagentAnnouncer", () => {
  it("delivers the result to SURFACE_CHAT with ORIGIN_SUBAGENT and result metadata", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const router: ISubagentAnnouncerRouter = { sendWithOrigin: send };
    const announce = createSubagentAnnouncer({
      surfaceRouter: router,
      getParentSessionId: () => "parent",
    });
    const now = Date.now();
    const run = {
      id: "r1",
      label: "lbl",
      task: "T",
      spawnedAt: now - 100,
      completedAt: now,
    } as never;
    await announce(run, "the result");
    expect(send).toHaveBeenCalledTimes(1);
    const [params, origin] = send.mock.calls[0];
    expect(origin).toBe(ORIGIN_SUBAGENT);
    expect(params.surfaceId).toBe(SURFACE_CHAT);
    expect(params.contentType).toBe("text");
    expect(params.content).toBe("the result");
    expect(params.metadata.subagentResult).toBe(true);
    expect(params.metadata.runId).toBe("r1");
    expect(params.metadata.parentSessionId).toBe("parent");
    expect(params.metadata.durationMs).toBe(100);
  });

  it("falls back to Date.now() when completedAt is missing", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const announce = createSubagentAnnouncer({
      surfaceRouter: { sendWithOrigin: send },
      getParentSessionId: () => undefined,
    });
    const run = {
      id: "r2", label: "l", task: "T", spawnedAt: Date.now() - 5,
    } as never;
    await announce(run, "x");
    const meta = send.mock.calls[0][0].metadata;
    expect(meta.parentSessionId).toBeUndefined();
    expect(typeof meta.durationMs).toBe("number");
    expect(meta.durationMs).toBeGreaterThanOrEqual(5);
  });
});
