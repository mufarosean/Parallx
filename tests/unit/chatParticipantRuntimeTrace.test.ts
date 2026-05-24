/**
 * Pin-the-invariant: buildParticipantRuntimeTrace — turnState gating, route mapping.
 */
import { describe, it, expect } from "vitest";
import { buildParticipantRuntimeTrace } from "../../src/built-in/chat/utilities/chatParticipantRuntimeTrace";

function makeReq(turnState: any) {
  return { turnState } as any;
}
function makeCtx(sessionId = "s1") {
  return { sessionId } as any;
}

describe("buildParticipantRuntimeTrace", () => {
  it("returns undefined when turnState is absent", () => {
    expect(buildParticipantRuntimeTrace(makeReq(undefined), makeCtx(), {})).toBeUndefined();
  });

  it("grounded route: needsRetrieval=true, citationMode=required", () => {
    const turnState = {
      turnRoute: { kind: "grounded", reason: "need files" },
      contextQueryText: "q",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: true,
    };
    const trace = buildParticipantRuntimeTrace(makeReq(turnState), makeCtx(), {});
    expect(trace).toBeDefined();
    expect(trace!.route).toBe(turnState.turnRoute);
    expect(trace!.contextPlan.route).toBe("grounded");
    expect(trace!.contextPlan.useRetrieval).toBe(true);
    expect(trace!.contextPlan.citationMode).toBe("required");
    expect(trace!.contextPlan.retrievalPlan?.queries).toEqual(["q"]);
    expect(trace!.runtime).toBe("claw");
    expect(trace!.sessionId).toBe("s1");
  });

  it("memory-recall: useMemoryRecall=true, citationMode=disabled", () => {
    const turnState = {
      turnRoute: { kind: "memory-recall", reason: "memory" },
      contextQueryText: "",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: false,
    };
    const trace = buildParticipantRuntimeTrace(makeReq(turnState), makeCtx(), {});
    expect(trace!.contextPlan.useMemoryRecall).toBe(true);
    expect(trace!.contextPlan.citationMode).toBe("disabled");
    expect(trace!.contextPlan.useRetrieval).toBe(false);
  });

  it("transcript-recall: useTranscriptRecall=true", () => {
    const turnState = {
      turnRoute: { kind: "transcript-recall", reason: "" },
      contextQueryText: "x",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: false,
    };
    const trace = buildParticipantRuntimeTrace(makeReq(turnState), makeCtx(), {});
    expect(trace!.contextPlan.useTranscriptRecall).toBe(true);
  });

  it("options.useCurrentPage / useConceptRecall flow into the contextPlan", () => {
    const turnState = {
      turnRoute: { kind: "free", reason: "" },
      contextQueryText: "x",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: false,
    };
    const trace = buildParticipantRuntimeTrace(makeReq(turnState), makeCtx(), {}, {
      useCurrentPage: true,
      useConceptRecall: true,
    });
    expect(trace!.contextPlan.useCurrentPage).toBe(true);
    expect(trace!.contextPlan.useConceptRecall).toBe(true);
  });

  it("patch wins via spread at the end", () => {
    const turnState = {
      turnRoute: { kind: "grounded", reason: "" },
      contextQueryText: "",
      queryScope: "all",
      hasActiveSlashCommand: false,
      isRagReady: true,
    };
    const trace = buildParticipantRuntimeTrace(makeReq(turnState), makeCtx(), {
      runtime: "openclaw" as any,
    });
    expect(trace!.runtime).toBe("openclaw");
  });
});
