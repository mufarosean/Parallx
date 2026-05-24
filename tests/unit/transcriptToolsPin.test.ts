/**
 * Pin: createTranscriptGetTool + createTranscriptSearchTool — metadata,
 * fs-missing fail path, missing sessionId, nonexistent transcript file,
 * happy path; search: disabled/not-ready/empty-query/no-results/formatted.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createTranscriptGetTool,
  createTranscriptSearchTool,
} from "../../src/built-in/chat/tools/transcriptTools";

const noopToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("built-in/chat/tools/transcriptTools — createTranscriptGetTool", () => {
  it("metadata: name/displaySummary/description/permissionLevel/requiresConfirmation/params", () => {
    const t = createTranscriptGetTool({} as any);
    expect(t.name).toBe("transcript_get");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.requiresConfirmation).toBe(false);
    expect(t.parameters.required).toEqual(["sessionId"]);
    expect(t.parameters.properties.sessionId.type).toBe("string");
    expect(t.displaySummary).toBeDefined();
    expect(t.description).toContain(".parallx/sessions");
  });

  it("returns isError + 'no workspace folder is open' when fs is undefined", async () => {
    const t = createTranscriptGetTool(undefined);
    const r = await t.handler({ sessionId: "abc" }, noopToken);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no workspace folder is open/);
  });

  it("returns isError when sessionId is missing/empty/whitespace", async () => {
    const t = createTranscriptGetTool({ exists: vi.fn(), readFileContent: vi.fn() } as any);
    for (const sessionId of ["", "   ", undefined]) {
      const r = await t.handler({ sessionId } as any, noopToken);
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/sessionId is required/);
    }
  });

  it("returns non-error 'No transcript exists' when fs.exists is false (path includes .parallx/sessions/<id>.jsonl)", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readFileContent: vi.fn() };
    const t = createTranscriptGetTool(fs as any);
    const r = await t.handler({ sessionId: "sess-1" }, noopToken);
    expect(r.isError).toBeUndefined();
    expect(fs.exists).toHaveBeenCalledWith(".parallx/sessions/sess-1.jsonl");
    expect(r.content).toContain(".parallx/sessions/sess-1.jsonl");
    expect(r.content).toMatch(/No transcript exists for session sess-1/);
  });

  it("trims sessionId before building the transcript path", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readFileContent: vi.fn() };
    const t = createTranscriptGetTool(fs as any);
    await t.handler({ sessionId: "  s2  " }, noopToken);
    expect(fs.exists).toHaveBeenCalledWith(".parallx/sessions/s2.jsonl");
  });

  it("happy path: reads + renders + includes header 'Transcript from <path>:'", async () => {
    const rawTurn = JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFileContent: vi.fn().mockResolvedValue({ content: rawTurn }),
    };
    const t = createTranscriptGetTool(fs as any);
    const r = await t.handler({ sessionId: "sess-1" }, noopToken);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Transcript from .parallx/sessions/sess-1.jsonl:");
    expect(r.content).toContain("hello");
  });

  it("empty render: returns 'exists but has no readable user/assistant turns yet'", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFileContent: vi.fn().mockResolvedValue({ content: "" }),
    };
    const t = createTranscriptGetTool(fs as any);
    const r = await t.handler({ sessionId: "s" }, noopToken);
    expect(r.content).toMatch(/has no readable user\/assistant turns yet/);
  });
});

describe("built-in/chat/tools/transcriptTools — createTranscriptSearchTool", () => {
  it("metadata: name/permissionLevel/required params", () => {
    const t = createTranscriptSearchTool(undefined);
    expect(t.name).toBe("transcript_search");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.requiresConfirmation).toBe(false);
    expect(t.parameters.required).toEqual(["query"]);
    expect(t.parameters.properties.query.type).toBe("string");
    expect(t.parameters.properties.sessionId.type).toBe("string");
  });

  it("returns 'disabled' message (no isError) when transcriptSearch is undefined", async () => {
    const t = createTranscriptSearchTool(undefined);
    const r = await t.handler({ query: "x" }, noopToken);
    expect(r.isError).toBeUndefined();
    expect(r.content).toMatch(/Transcript search is disabled/);
    expect(r.content).toContain("memory.transcriptIndexingEnabled");
  });

  it("returns 'disabled' when isEnabled() is false", async () => {
    const ts = { isEnabled: () => false, isReady: () => true, search: vi.fn() };
    const r = await createTranscriptSearchTool(ts as any).handler({ query: "x" }, noopToken);
    expect(r.content).toMatch(/Transcript search is disabled/);
  });

  it("returns 'indexing is still in progress' when isEnabled()=true but isReady()=false", async () => {
    const ts = { isEnabled: () => true, isReady: () => false, search: vi.fn() };
    const r = await createTranscriptSearchTool(ts as any).handler({ query: "x" }, noopToken);
    expect(r.content).toMatch(/indexing is still in progress/);
  });

  it("returns isError on empty query", async () => {
    const ts = { isEnabled: () => true, isReady: () => true, search: vi.fn() };
    const r = await createTranscriptSearchTool(ts as any).handler({ query: "   " }, noopToken);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Search query is empty/);
  });

  it("'no results' returns content without isError", async () => {
    const ts = { isEnabled: () => true, isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const r = await createTranscriptSearchTool(ts as any).handler({ query: "hello" }, noopToken);
    expect(r.isError).toBeUndefined();
    expect(r.content).toBe('No transcript results found for "hello".');
  });

  it("formats results: 'Found N transcript result(s):' header + [idx], Session <id>, Path:, Source:, Score: with 3 decimals", async () => {
    const ts = {
      isEnabled: () => true,
      isReady: () => true,
      search: vi.fn().mockResolvedValue([
        { sourceId: "p1", contextPrefix: "ctx", text: "T1", score: 0.5, sessionId: "S1" },
        { sourceId: "p2", contextPrefix: "", text: "T2", score: 0.876543, sessionId: "S2" },
      ]),
    };
    const r = await createTranscriptSearchTool(ts as any).handler({ query: "q", sessionId: "S1" }, noopToken);
    expect(r.content).toMatch(/^Found 2 transcript result\(s\):/);
    expect(r.content).toContain("[1] Session S1");
    expect(r.content).toContain("Path: p1");
    expect(r.content).toContain("Source: ctx");
    expect(r.content).toContain("Score: 0.500");
    expect(r.content).toContain("Source: p2"); // empty contextPrefix falls back to sourceId
    expect(r.content).toContain("Score: 0.877");
    expect(ts.search).toHaveBeenCalledWith("q", { sessionId: "S1" });
  });
});
