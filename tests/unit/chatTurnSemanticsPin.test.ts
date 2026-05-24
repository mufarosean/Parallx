/**
 * Pin: analyzeChatTurnSemantics — conversational / memory-recall / transcript /
 * file-enumeration classification (pure regex pipeline).
 */
import { describe, it, expect } from "vitest";
import { analyzeChatTurnSemantics } from "../../src/built-in/chat/utilities/chatTurnSemantics";

describe("built-in/chat/utilities/chatTurnSemantics", () => {
  it("returns rawText, normalizedText, and strippedApostropheText", () => {
    const r = analyzeChatTurnSemantics("  Hi, How's it Going?  ");
    expect(r.rawText).toBe("  Hi, How's it Going?  ");
    expect(r.normalizedText).toBe("hi how s it going ");
    expect(r.strippedApostropheText).toBe("hi hows it going ");
  });

  it("classifies short greetings as conversational", () => {
    for (const s of ["hi", "hello", "hey", "yo", "sup", "good morning"]) {
      expect(analyzeChatTurnSemantics(s).isConversational).toBe(true);
    }
  });

  it("classifies thanks / bye / acks as conversational", () => {
    for (const s of ["thanks", "thank you", "ok", "okay", "cool", "bye", "goodbye", "got it"]) {
      expect(analyzeChatTurnSemantics(s).isConversational).toBe(true);
    }
  });

  it("greeting + social follow-up is conversational ('hey how is it going')", () => {
    expect(analyzeChatTurnSemantics("hey how is it going").isConversational).toBe(true);
    expect(analyzeChatTurnSemantics("hi whats up").isConversational).toBe(true);
  });

  it("workspace/task routing terms force non-conversational", () => {
    expect(analyzeChatTurnSemantics("hi can you read this file").isConversational).toBe(false);
    expect(analyzeChatTurnSemantics("thanks search the workspace").isConversational).toBe(false);
  });

  it("text longer than 80 chars is not conversational", () => {
    const s = "hi ".repeat(40);
    expect(analyzeChatTurnSemantics(s).isConversational).toBe(false);
  });

  it("explicit memory recall phrases set isExplicitMemoryRecall", () => {
    expect(analyzeChatTurnSemantics("what do you remember about my project").isExplicitMemoryRecall).toBe(true);
    expect(analyzeChatTurnSemantics("our last conversation").isExplicitMemoryRecall).toBe(true);
    expect(analyzeChatTurnSemantics("from memory, what did we agree on").isExplicitMemoryRecall).toBe(true);
    expect(analyzeChatTurnSemantics("recall my previous chat").isExplicitMemoryRecall).toBe(true);
  });

  it("transcript keyword suppresses memory recall (transcript wins)", () => {
    expect(analyzeChatTurnSemantics("what do you remember about my transcript").isExplicitMemoryRecall).toBe(false);
    expect(analyzeChatTurnSemantics("show me the transcript").isExplicitTranscriptRecall).toBe(true);
  });

  it("transcript / session-history phrases set isExplicitTranscriptRecall", () => {
    expect(analyzeChatTurnSemantics("show me the chat history").isExplicitTranscriptRecall).toBe(true);
    expect(analyzeChatTurnSemantics("what did we discuss in the last session").isExplicitTranscriptRecall).toBe(true);
    expect(analyzeChatTurnSemantics("what did i say earlier").isExplicitTranscriptRecall).toBe(true);
  });

  it("file enumeration: question + workspace/folder term sets isFileEnumeration", () => {
    expect(analyzeChatTurnSemantics("what is in the folder").isFileEnumeration).toBe(true);
    expect(analyzeChatTurnSemantics("list the files in my workspace").isFileEnumeration).toBe(true);
    expect(analyzeChatTurnSemantics("how many files are in this directory").isFileEnumeration).toBe(true);
  });

  it("file enumeration question without folder/dir/workspace keyword does NOT match", () => {
    expect(analyzeChatTurnSemantics("what is in the dog").isFileEnumeration).toBe(false);
  });

  it("very long turn (>200 chars) skips file-enumeration classifier", () => {
    const s = "what is in the folder " + "a".repeat(250);
    expect(analyzeChatTurnSemantics(s).isFileEnumeration).toBe(false);
  });

  it("empty / whitespace input: all classifiers false", () => {
    const r = analyzeChatTurnSemantics("   ");
    expect(r.isConversational).toBe(false);
    expect(r.isExplicitMemoryRecall).toBe(false);
    expect(r.isExplicitTranscriptRecall).toBe(false);
    expect(r.isFileEnumeration).toBe(false);
  });
});
