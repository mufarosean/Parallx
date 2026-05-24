/**
 * Pin-the-invariant: utilities/chatParticipantCommandDispatcher — handler routing.
 */
import { describe, it, expect, vi } from "vitest";
import { dispatchScopedParticipantCommand } from "../../src/built-in/chat/utilities/chatParticipantCommandDispatcher";

function fakeServices() {
  return { reportRetrievalDebug: vi.fn() };
}

const baseOpts = (overrides: any = {}) => ({
  surface: "workspace" as const,
  context: {} as any,
  response: {} as any,
  token: {} as any,
  services: fakeServices(),
  handlers: {},
  defaultHandler: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
});

describe("dispatchScopedParticipantCommand", () => {
  it("invokes named handler when commandName matches", async () => {
    const named = vi.fn().mockResolvedValue({ via: "named" });
    const defaultHandler = vi.fn().mockResolvedValue({ via: "default" });
    const opts = baseOpts({
      request: { text: "x", command: "init" },
      handlers: { init: named },
      defaultHandler,
    });
    const out = await dispatchScopedParticipantCommand(opts);
    expect(out).toEqual({ via: "named" });
    expect(named).toHaveBeenCalledTimes(1);
    expect(defaultHandler).not.toHaveBeenCalled();
  });

  it("falls back to defaultHandler when commandName has no entry", async () => {
    const defaultHandler = vi.fn().mockResolvedValue({ via: "default" });
    const opts = baseOpts({
      request: { text: "x", command: "unknown" },
      handlers: { init: vi.fn() },
      defaultHandler,
    });
    const out = await dispatchScopedParticipantCommand(opts);
    expect(out).toEqual({ via: "default" });
    expect(defaultHandler).toHaveBeenCalledTimes(1);
  });

  it("uses defaultHandler when there is no command", async () => {
    const defaultHandler = vi.fn().mockResolvedValue({ via: "default" });
    const opts = baseOpts({
      request: { text: "hello" },
      defaultHandler,
    });
    await dispatchScopedParticipantCommand(opts);
    expect(defaultHandler).toHaveBeenCalled();
  });

  it("reports retrieval debug with hasActiveSlashCommand reflecting interpretation", async () => {
    const services = fakeServices();
    const opts = baseOpts({
      request: { text: "x", command: "init" },
      services,
      defaultHandler: vi.fn().mockResolvedValue({}),
    });
    await dispatchScopedParticipantCommand(opts);
    expect(services.reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: true,
      isRagReady: false,
      needsRetrieval: false,
      attempted: false,
    });
  });

  it("forwards interpretation + request + context + response + token + services to handler", async () => {
    const handler = vi.fn().mockResolvedValue({});
    const ctx = { ctx: true } as any;
    const response = { r: true } as any;
    const token = { t: true } as any;
    const services = fakeServices();
    const request = { text: "hi", command: "init" } as any;
    const opts = baseOpts({
      request,
      context: ctx,
      response,
      token,
      services,
      handlers: { init: handler },
      defaultHandler: vi.fn(),
    });
    await dispatchScopedParticipantCommand(opts);
    const args = handler.mock.calls[0];
    expect(args[0].commandName).toBe("init");
    expect(args[1]).toBe(request);
    expect(args[2]).toBe(ctx);
    expect(args[3]).toBe(response);
    expect(args[4]).toBe(token);
    expect(args[5]).toBe(services);
  });
});
