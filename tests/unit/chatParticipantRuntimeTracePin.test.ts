/**
 * Pin: buildParticipantRuntimeTrace — turnState → IChatRuntimeTrace
 * mapping used by chat participants to report runtime trace records.
 * Locks the route + contextPlan derivations, citation-mode logic, and
 * options overrides.
 */
import { describe, it, expect } from "vitest";
import { buildParticipantRuntimeTrace } from "../../src/built-in/chat/utilities/chatParticipantRuntimeTrace";

function baseRequest(turnState: any): any {
  return { turnState };
}

const baseContext: any = { sessionId: "sess-1" };

const groundedTurnState = {
  turnRoute: { kind: "grounded", reason: "answer needs sources" },
  contextQueryText: "what is x",
  queryScope: { documentIds: ["d1"] },
  hasActiveSlashCommand: false,
  isRagReady: true,
};

describe("buildParticipantRuntimeTrace", () => {
  it("returns undefined when turnState is missing", () => {
    expect(buildParticipantRuntimeTrace({ turnState: undefined } as any, baseContext, {})).toBeUndefined();
  });

  it("returns trace with route, contextPlan, sessionId, flags, runtime='claw' for grounded route", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest(groundedTurnState) as any,
      baseContext,
      {},
    );
    expect(trace).toBeDefined();
    expect(trace!.route).toBe(groundedTurnState.turnRoute);
    expect(trace!.queryScope).toBe(groundedTurnState.queryScope);
    expect(trace!.sessionId).toBe("sess-1");
    expect(trace!.hasActiveSlashCommand).toBe(false);
    expect(trace!.isRagReady).toBe(true);
    expect(trace!.runtime).toBe("claw");
  });

  it("for grounded route: contextPlan.useRetrieval=true, citationMode='required', queries from contextQueryText", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest(groundedTurnState) as any,
      baseContext,
      {},
    );
    expect(trace!.contextPlan.route).toBe("grounded");
    expect(trace!.contextPlan.intent).toBe("question");
    expect(trace!.contextPlan.useRetrieval).toBe(true);
    expect(trace!.contextPlan.useMemoryRecall).toBe(false);
    expect(trace!.contextPlan.useTranscriptRecall).toBe(false);
    expect(trace!.contextPlan.citationMode).toBe("required");
    expect(trace!.contextPlan.reasoning).toBe("answer needs sources");
    expect(trace!.contextPlan.retrievalPlan.queries).toEqual(["what is x"]);
    expect(trace!.contextPlan.retrievalPlan.needsRetrieval).toBe(true);
  });

  it("non-grounded route: useRetrieval=false, citationMode='disabled'", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest({
        ...groundedTurnState,
        turnRoute: { kind: "general", reason: "chitchat" },
      }) as any,
      baseContext,
      {},
    );
    expect(trace!.contextPlan.useRetrieval).toBe(false);
    expect(trace!.contextPlan.citationMode).toBe("disabled");
    expect(trace!.contextPlan.retrievalPlan.needsRetrieval).toBe(false);
  });

  it("memory-recall route flips useMemoryRecall=true (others false)", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest({
        ...groundedTurnState,
        turnRoute: { kind: "memory-recall", reason: "remember" },
      }) as any,
      baseContext,
      {},
    );
    expect(trace!.contextPlan.useMemoryRecall).toBe(true);
    expect(trace!.contextPlan.useTranscriptRecall).toBe(false);
  });

  it("transcript-recall route flips useTranscriptRecall=true (others false)", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest({
        ...groundedTurnState,
        turnRoute: { kind: "transcript-recall", reason: "last week" },
      }) as any,
      baseContext,
      {},
    );
    expect(trace!.contextPlan.useTranscriptRecall).toBe(true);
    expect(trace!.contextPlan.useMemoryRecall).toBe(false);
  });

  it("options.useCurrentPage / useConceptRecall flow into contextPlan; default to false when omitted", () => {
    const t1 = buildParticipantRuntimeTrace(baseRequest(groundedTurnState) as any, baseContext, {});
    expect(t1!.contextPlan.useCurrentPage).toBe(false);
    expect(t1!.contextPlan.useConceptRecall).toBe(false);

    const t2 = buildParticipantRuntimeTrace(
      baseRequest(groundedTurnState) as any,
      baseContext,
      {},
      { useCurrentPage: true, useConceptRecall: true },
    );
    expect(t2!.contextPlan.useCurrentPage).toBe(true);
    expect(t2!.contextPlan.useConceptRecall).toBe(true);
  });

  it("patch overrides take precedence over derived defaults (spread last)", () => {
    const trace = buildParticipantRuntimeTrace(
      baseRequest(groundedTurnState) as any,
      baseContext,
      { runtime: "openclaw", runId: "r-99", phase: "execution", note: "patched" } as any,
    );
    expect(trace!.runtime).toBe("openclaw");
    expect(trace!.runId).toBe("r-99");
    expect(trace!.phase).toBe("execution");
    expect(trace!.note).toBe("patched");
    // Non-patched fields stay derived
    expect(trace!.sessionId).toBe("sess-1");
  });
});
