/**
 * Pin-the-invariant: built-in/chat/utilities/chatMentionResolver.ts —
 * mention extraction, strip, and resolve.
 */
import { describe, it, expect, vi } from "vitest";
import {
  extractMentions,
  stripMentions,
  resolveMentions,
} from "../../src/built-in/chat/utilities/chatMentionResolver";

describe("extractMentions", () => {
  it("returns empty array on plain text", () => {
    expect(extractMentions("just a message")).toEqual([]);
  });

  it("recognizes @workspace and @terminal tokens", () => {
    const m = extractMentions("look at @workspace and @terminal please");
    const kinds = m.map((x) => x.kind);
    expect(kinds).toContain("workspace");
    expect(kinds).toContain("terminal");
  });

  it("recognizes @file:path and @folder:path tokens with unquoted path", () => {
    const m = extractMentions("@file:src/a.ts and @folder:src/lib");
    const file = m.find((x) => x.kind === "file") as any;
    const folder = m.find((x) => x.kind === "folder") as any;
    expect(file?.path).toBe("src/a.ts");
    expect(folder?.path).toBe("src/lib");
  });

  it("tracks start/end offsets aligned to original", () => {
    const t = "x @workspace y";
    const [m] = extractMentions(t);
    expect(t.slice(m.start, m.end)).toBe(m.original);
  });
});

describe("stripMentions", () => {
  it("returns original text when mentions is empty", () => {
    expect(stripMentions("hello world", [])).toBe("hello world");
  });

  it("removes all mention spans + collapses spaces", () => {
    const text = "look at @workspace and @terminal please";
    const m = extractMentions(text);
    const stripped = stripMentions(text, m);
    expect(stripped).toBe("look at and please");
  });

  it("processes spans in reverse so earlier offsets stay valid", () => {
    const text = "@workspace @terminal end";
    const m = extractMentions(text);
    const stripped = stripMentions(text, m);
    expect(stripped).toBe("end");
  });
});

describe("resolveMentions", () => {
  it("returns clean text + empty arrays when no mentions / services empty", async () => {
    const r = await resolveMentions("hello", [], {} as any);
    expect(r.cleanText).toBe("hello");
    expect(r.contextBlocks).toEqual([]);
    expect(r.pills).toEqual([]);
  });

  it("file mention: reads content + emits attachment pill", async () => {
    const readFileContent = vi.fn().mockResolvedValue("contents here");
    const text = "see @file:a.ts please";
    const mentions = extractMentions(text);
    const r = await resolveMentions(text, mentions, { readFileContent } as any);
    expect(readFileContent).toHaveBeenCalledWith("a.ts");
    expect(r.contextBlocks.join("\n")).toContain("contents here");
    expect(r.pills[0]).toMatchObject({ type: "attachment", removable: true });
    expect(r.cleanText).toBe("see please");
  });

  it("file mention swallows readFileContent errors with [Could not read file]", async () => {
    const readFileContent = vi.fn().mockRejectedValue(new Error("nope"));
    const text = "@file:bad.ts";
    const r = await resolveMentions(text, extractMentions(text), { readFileContent } as any);
    expect(r.contextBlocks[0]).toContain("Could not read file");
  });

  it("workspace mention uses clean text as RAG query", async () => {
    const retrieveContext = vi.fn().mockResolvedValue({
      text: "RAG-CONTEXT",
      sources: [{ uri: "u1", label: "L1" }],
    });
    const text = "@workspace what is X";
    const r = await resolveMentions(text, extractMentions(text), {
      retrieveContext,
    } as any);
    expect(retrieveContext).toHaveBeenCalledWith("what is X");
    expect(r.contextBlocks[0]).toBe("RAG-CONTEXT");
    expect(r.pills[0]).toMatchObject({ type: "rag", label: "L1" });
  });

  it("terminal mention captures output + tokens", async () => {
    const getTerminalOutput = vi.fn().mockResolvedValue("$ ls\nfoo bar");
    const text = "see @terminal";
    const r = await resolveMentions(text, extractMentions(text), {
      getTerminalOutput,
    } as any);
    expect(r.contextBlocks[0]).toContain("[Terminal output]");
    expect(r.pills[0]).toMatchObject({ id: "mention-terminal", label: "Terminal output" });
  });
});
