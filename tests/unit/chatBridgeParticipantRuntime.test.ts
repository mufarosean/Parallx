/**
 * Pin-the-invariant: createBridgeParticipantRuntime — interpretation pipeline,
 * trace phases, error path, metadata boundary.
 */
import { describe, it, expect, vi } from "vitest";
import { createBridgeParticipantRuntime } from "../../src/built-in/chat/utilities/chatBridgeParticipantRuntime";

function makeRequest(overrides: Partial<any> = {}) {
  return {
    text: "hello",
    command: undefined,
    turnState: {
      turnRoute: { kind: "free", reason: "" },
      contextQueryText: "",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: false,
    },
    ...overrides,
  } as any;
}

function makeCtx(reportTrace = vi.fn()) {
  return {
    sessionId: "s1",
    runtime: { reportTrace },
  } as any;
}

describe("createBridgeParticipantRuntime", () => {
  it("returns kind=claw", () => {
    const rt = createBridgeParticipantRuntime({
      participantId: "p",
      handler: async () => ({ metadata: undefined } as any),
    });
    expect(rt.kind).toBe("claw");
  });

  it("normalizes request via interpretation + reports start & complete trace", async () => {
    const reportTrace = vi.fn();
    const ctx = makeCtx(reportTrace);
    const handler = vi.fn(async (req) => {
      expect(req.interpretation).toBeDefined();
      expect(req.interpretation.surface).toBe("bridge");
      return { metadata: undefined } as any;
    });
    const rt = createBridgeParticipantRuntime({ participantId: "p1", handler });
    const result = await rt.handleTurn(makeRequest(), ctx, {} as any, {} as any);
    expect(handler).toHaveBeenCalledOnce();
    const calls = reportTrace.mock.calls.map((c) => c[0]);
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatchObject({ checkpoint: "bridge-handler-start", runState: "executing" });
    expect(calls[1]).toMatchObject({ checkpoint: "bridge-handler-complete", runState: "completed" });
    expect((result.metadata as any).runtimeBoundary).toMatchObject({
      type: "bridge-compatibility",
      participantId: "p1",
      runtime: "claw",
    });
  });

  it("preserves existing metadata when stamping the runtimeBoundary", async () => {
    const handler = async () => ({ metadata: { foo: 1 } } as any);
    const rt = createBridgeParticipantRuntime({ participantId: "pX", handler });
    const result = await rt.handleTurn(makeRequest(), makeCtx(), {} as any, {} as any);
    expect((result.metadata as any).foo).toBe(1);
    expect((result.metadata as any).runtimeBoundary.participantId).toBe("pX");
  });

  it("rejects: reports failed trace then rethrows", async () => {
    const reportTrace = vi.fn();
    const ctx = makeCtx(reportTrace);
    const err = new Error("boom");
    const handler = async () => {
      throw err;
    };
    const rt = createBridgeParticipantRuntime({ participantId: "p", handler });
    await expect(rt.handleTurn(makeRequest(), ctx, {} as any, {} as any)).rejects.toBe(err);
    const last = reportTrace.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({ checkpoint: "bridge-handler-error", runState: "failed", note: "boom" });
  });

  it("treats array metadata as if absent (replaces with {runtimeBoundary})", async () => {
    const handler = async () => ({ metadata: [] } as any);
    const rt = createBridgeParticipantRuntime({ participantId: "pZ", handler });
    const result = await rt.handleTurn(makeRequest(), makeCtx(), {} as any, {} as any);
    expect(Array.isArray(result.metadata)).toBe(false);
    expect((result.metadata as any).runtimeBoundary).toBeDefined();
  });
});
