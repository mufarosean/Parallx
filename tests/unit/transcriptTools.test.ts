/**
 * Pin-the-invariant: tools/transcriptTools — transcript_get + transcript_search.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createTranscriptGetTool,
  createTranscriptSearchTool,
} from "../../src/built-in/chat/tools/transcriptTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("transcript_get tool", () => {
  it("declares stable name + required sessionId", () => {
    const t = createTranscriptGetTool(undefined);
    expect(t.name).toBe("transcript_get");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.parameters.required).toEqual(["sessionId"]);
  });

  it("errors when fs is undefined", async () => {
    const t = createTranscriptGetTool(undefined);
    const r = await t.handler({ sessionId: "abc" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("no workspace folder is open");
  });

  it("errors when sessionId blank", async () => {
    const t = createTranscriptGetTool({ exists: vi.fn(), readFileContent: vi.fn() } as any);
    const r = await t.handler({ sessionId: "  " }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toBe("sessionId is required.");
  });

  it("informs when transcript file does not exist", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readFileContent: vi.fn() };
    const t = createTranscriptGetTool(fs as any);
    const r = await t.handler({ sessionId: "abc" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("No transcript exists for session abc");
    expect(r.content).toContain(".parallx/sessions/abc.jsonl");
  });

  it("reads transcript file content via fs.readFileContent", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFileContent: vi.fn().mockResolvedValue({ content: "" }),
    };
    const t = createTranscriptGetTool(fs as any);
    const r = await t.handler({ sessionId: "abc" }, token);
    expect(fs.readFileContent).toHaveBeenCalledWith(".parallx/sessions/abc.jsonl");
    expect(r.content).toContain(".parallx/sessions/abc.jsonl");
  });
});

describe("transcript_search tool", () => {
  it("declares stable name + required query", () => {
    const t = createTranscriptSearchTool(undefined);
    expect(t.name).toBe("transcript_search");
    expect(t.parameters.required).toEqual(["query"]);
  });

  it("informs when search is undefined (treated as disabled)", async () => {
    const t = createTranscriptSearchTool(undefined);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Transcript search is disabled");
  });

  it("informs when isEnabled false", async () => {
    const svc = { isEnabled: () => false, isReady: () => true, search: vi.fn() };
    const t = createTranscriptSearchTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.content).toContain("disabled");
    expect(svc.search).not.toHaveBeenCalled();
  });

  it("informs when isReady false", async () => {
    const svc = { isEnabled: () => true, isReady: () => false, search: vi.fn() };
    const t = createTranscriptSearchTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.content).toContain("still in progress");
  });

  it("errors on empty query", async () => {
    const svc = { isEnabled: () => true, isReady: () => true, search: vi.fn() };
    const t = createTranscriptSearchTool(svc as any);
    const r = await t.handler({ query: "   " }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("empty");
  });

  it("returns no-results message when search yields []", async () => {
    const svc = { isEnabled: () => true, isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const t = createTranscriptSearchTool(svc as any);
    const r = await t.handler({ query: "topic" }, token);
    expect(r.content).toContain('No transcript results found for "topic"');
  });

  it("forwards sessionId filter when provided", async () => {
    const svc = { isEnabled: () => true, isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const t = createTranscriptSearchTool(svc as any);
    await t.handler({ query: "x", sessionId: "abc" }, token);
    expect(svc.search).toHaveBeenCalledWith("x", { sessionId: "abc" });
  });

  it("omits sessionId filter when blank", async () => {
    const svc = { isEnabled: () => true, isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const t = createTranscriptSearchTool(svc as any);
    await t.handler({ query: "x", sessionId: "   " }, token);
    expect(svc.search).toHaveBeenCalledWith("x", { sessionId: undefined });
  });

  it("formats matches with index, session, score", async () => {
    const svc = {
      isEnabled: () => true,
      isReady: () => true,
      search: vi.fn().mockResolvedValue([
        { sourceId: ".parallx/sessions/s1.jsonl", contextPrefix: "User: hello", text: "user said hi", score: 0.8, sessionId: "s1" },
      ]),
    };
    const t = createTranscriptSearchTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.content).toContain("Found 1 transcript result");
    expect(r.content).toContain("Session s1");
    expect(r.content).toContain("0.800");
  });
});
