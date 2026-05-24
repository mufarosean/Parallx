/**
 * Pin-the-invariant: utilities/chatParticipantInterpretation.interpretChatParticipantRequest.
 */
import { describe, it, expect } from "vitest";
import { interpretChatParticipantRequest } from "../../src/built-in/chat/utilities/chatParticipantInterpretation";

describe("interpretChatParticipantRequest", () => {
  it("uses request.text.trim() as effectiveText when no interpretation provided", () => {
    const r = interpretChatParticipantRequest("workspace", { text: "  hello world  " } as any);
    expect(r.effectiveText).toBe("hello world");
    expect(r.rawText).toBe("  hello world  ");
    expect(r.surface).toBe("workspace");
  });

  it("derives commandName from request.command (trimmed) when present", () => {
    const r = interpretChatParticipantRequest("canvas", { text: "do thing", command: "  init  " } as any);
    expect(r.commandName).toBe("init");
    expect(r.hasExplicitCommand).toBe(true);
    expect(r.kind).toBe("command");
  });

  it("marks kind='message' when no explicit command", () => {
    const r = interpretChatParticipantRequest("workspace", { text: "hi" } as any);
    expect(r.hasExplicitCommand).toBe(false);
    expect(r.kind).toBe("message");
  });

  it("prefers provided interpretation fields over request fields", () => {
    const provided = {
      surface: "canvas" as const,
      rawText: "PROVIDED RAW",
      effectiveText: "PROVIDED EFF",
      commandName: "x",
      hasExplicitCommand: true,
      kind: "command" as const,
      semantics: { tag: "stub" } as any,
    };
    const r = interpretChatParticipantRequest("workspace", { text: "ignored", interpretation: provided } as any);
    expect(r.surface).toBe("canvas");
    expect(r.rawText).toBe("PROVIDED RAW");
    expect(r.effectiveText).toBe("PROVIDED EFF");
    expect(r.commandName).toBe("x");
    expect(r.semantics).toEqual({ tag: "stub" });
  });

  it("falls back to provided.commandName when request.command empty", () => {
    const r = interpretChatParticipantRequest("workspace", {
      text: "",
      command: "",
      interpretation: { commandName: "fallbackCmd", hasExplicitCommand: true } as any,
    } as any);
    expect(r.commandName).toBe("fallbackCmd");
    expect(r.hasExplicitCommand).toBe(true);
  });

  it("computes semantics from effectiveText when none provided", () => {
    const r = interpretChatParticipantRequest("workspace", { text: "What is this?" } as any);
    expect(r.semantics).toBeDefined();
  });
});
