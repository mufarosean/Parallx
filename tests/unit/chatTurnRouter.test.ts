/**
 * Pin-the-invariant: utilities/chatTurnRouter.determineChatTurnRoute.
 */
import { describe, it, expect } from "vitest";
import { determineChatTurnRoute } from "../../src/built-in/chat/utilities/chatTurnRouter";

describe("determineChatTurnRoute", () => {
  it("returns grounded when an active slash command is signalled", () => {
    const r = determineChatTurnRoute({} as any, { hasActiveSlashCommand: true });
    expect(r.kind).toBe("grounded");
    expect(r.reason).toMatch(/Slash command/);
  });

  it("routes to transcript-recall for explicit prior-session phrases", () => {
    const sem = { isExplicitTranscriptRecall: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("transcript-recall");
  });

  it("routes to memory-recall for explicit prior-conversation phrases", () => {
    const sem = { isExplicitMemoryRecall: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("memory-recall");
  });

  it("routes to conversational for short conversational turns", () => {
    const sem = { isConversational: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("conversational");
  });

  it("routes file-enumeration to grounded with file-tool reason", () => {
    const sem = { isFileEnumeration: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("grounded");
    expect(r.reason).toMatch(/File or directory enumeration/);
  });

  it("falls through to default grounded route", () => {
    const sem = {} as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("grounded");
    expect(r.reason).toMatch(/Default grounded route/);
  });

  it("priority: transcript-recall before memory-recall", () => {
    const sem = { isExplicitTranscriptRecall: true, isExplicitMemoryRecall: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("transcript-recall");
  });

  it("priority: memory-recall before conversational", () => {
    const sem = { isExplicitMemoryRecall: true, isConversational: true } as any;
    const r = determineChatTurnRoute(sem);
    expect(r.kind).toBe("memory-recall");
  });

  it("string input is analyzed via chatTurnSemantics", () => {
    const r = determineChatTurnRoute("hello");
    expect(r.kind).toBeDefined();
  });
});
