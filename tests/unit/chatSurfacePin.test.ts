/**
 * Pin: ChatSurfacePlugin — autonomy delivery routing to AutonomyLogService.
 * Pins surface id, capabilities, origin resolution, request-text formatting,
 * markdown rendering for structured content, logger fallback, and the
 * options-or-bare-logger constructor.
 */
import { describe, it, expect, vi } from "vitest";
import { ChatSurfacePlugin } from "../../src/built-in/chat/surfaces/chatSurface";

interface AppendArg {
  origin: string;
  requestText: string;
  content: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
}

function makeLog() {
  const calls: AppendArg[] = [];
  return {
    appender: {
      append: (entry: AppendArg) => {
        calls.push(entry);
      },
    } as any,
    calls,
  };
}

function delivery(overrides: Partial<{
  id: string;
  contentType: string;
  content: unknown;
  metadata: Record<string, unknown>;
}> = {}): any {
  return {
    id: overrides.id ?? "d1",
    surfaceId: "chat",
    contentType: overrides.contentType ?? "text",
    content: "content" in overrides ? overrides.content : "hello",
    metadata: overrides.metadata,
    createdAt: Date.now(),
  };
}

describe("ChatSurfacePlugin — identity + capabilities", () => {
  it("id === 'chat'; capabilities text+structured, no binary, no actions", () => {
    const p = new ChatSurfacePlugin();
    expect(p.id).toBe("chat");
    expect(p.capabilities).toEqual({
      supportsText: true,
      supportsStructured: true,
      supportsBinary: false,
      supportsActions: false,
    });
    expect(p.isAvailable()).toBe(true);
  });
});

describe("ChatSurfacePlugin — bare-logger constructor (trace-only)", () => {
  it("when constructed with a function, calls it on every deliver and returns true", async () => {
    const logger = vi.fn();
    const p = new ChatSurfacePlugin(logger);
    const r = await p.deliver(delivery());
    expect(r).toBe(true);
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it("swallows logger errors", async () => {
    const p = new ChatSurfacePlugin(() => { throw new Error("boom"); });
    await expect(p.deliver(delivery())).resolves.toBe(true);
  });
});

describe("ChatSurfacePlugin — origin resolution", () => {
  it("uses metadata._origin when present", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { _origin: "research" } }));
    expect(log.calls[0].origin).toBe("research");
    expect(log.calls[0].requestText).toBe("[research]");
  });

  it("heartbeatResult metadata → origin='heartbeat'", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { heartbeatResult: {} } }));
    expect(log.calls[0].origin).toBe("heartbeat");
    expect(log.calls[0].requestText).toBe("[heartbeat]");
  });

  it("cronResult metadata → origin='cron'; jobName appended to request text", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { cronResult: {}, jobName: "nightly" } }));
    expect(log.calls[0].origin).toBe("cron");
    expect(log.calls[0].requestText).toBe("[cron · nightly]");
  });

  it("subagentResult metadata → origin='subagent'; request text is '[subagent]'", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { subagentResult: {} } }));
    expect(log.calls[0].origin).toBe("subagent");
    expect(log.calls[0].requestText).toBe("[subagent]");
  });

  it("no metadata → origin='agent'", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery());
    expect(log.calls[0].origin).toBe("agent");
    expect(log.calls[0].requestText).toBe("[agent]");
  });

  it("heartbeat reason → '[heartbeat · <reason>]'", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { heartbeatResult: {}, reason: "tick" } }));
    expect(log.calls[0].requestText).toBe("[heartbeat · tick]");
  });

  it("heartbeat systemEvent.reason as fallback label", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ metadata: { heartbeatResult: {}, systemEvent: { reason: "wake" } } }));
    expect(log.calls[0].requestText).toBe("[heartbeat · wake]");
  });
});

describe("ChatSurfacePlugin — content rendering", () => {
  it("string content passes through unchanged", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ content: "hello world" }));
    expect(log.calls[0].content).toBe("hello world");
  });

  it("object content rendered as ```json fenced block (pretty-printed)", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ content: { a: 1 } }));
    expect(log.calls[0].content).toBe("```json\n{\n  \"a\": 1\n}\n```");
  });

  it("empty content (null) is skipped — no append call", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ content: null as any }));
    expect(log.calls).toHaveLength(0);
  });

  it("empty string content is skipped — no append call", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery({ content: "" }));
    expect(log.calls).toHaveLength(0);
  });
});

describe("ChatSurfacePlugin — session id stamping", () => {
  it("passes getActiveSessionId() result through to the appender", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({
      autonomyLog: log.appender,
      getActiveSessionId: () => "S-42",
    });
    await p.deliver(delivery());
    expect(log.calls[0].sessionId).toBe("S-42");
  });

  it("undefined session id when resolver is absent", async () => {
    const log = makeLog();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender });
    await p.deliver(delivery());
    expect(log.calls[0].sessionId).toBeUndefined();
  });
});

describe("ChatSurfacePlugin — trace logger runs alongside append", () => {
  it("logger called even when appender present", async () => {
    const log = makeLog();
    const logger = vi.fn();
    const p = new ChatSurfacePlugin({ autonomyLog: log.appender, logger });
    await p.deliver(delivery());
    expect(logger).toHaveBeenCalledTimes(1);
    expect(log.calls).toHaveLength(1);
  });

  it("appender errors surface (not swallowed); logger still ran", async () => {
    const logger = vi.fn();
    const bad = { append: () => { throw new Error("boom"); } } as any;
    const p = new ChatSurfacePlugin({ autonomyLog: bad, logger });
    await expect(p.deliver(delivery())).rejects.toThrow("boom");
    expect(logger).toHaveBeenCalledTimes(1);
  });
});

describe("ChatSurfacePlugin — dispose is a no-op", () => {
  it("does not throw and can be called multiple times", () => {
    const p = new ChatSurfacePlugin();
    expect(() => { p.dispose(); p.dispose(); }).not.toThrow();
  });
});
