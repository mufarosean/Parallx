/**
 * Pin-the-invariant: tools/memoryTools — memory_get + memory_search.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createMemoryGetTool,
  createMemorySearchTool,
} from "../../src/built-in/chat/tools/memoryTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("memory_get tool", () => {
  it("declares stable name + always-allowed", () => {
    const t = createMemoryGetTool(undefined);
    expect(t.name).toBe("memory_get");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.requiresConfirmation).toBe(false);
  });

  it("errors when fs undefined", async () => {
    const t = createMemoryGetTool(undefined);
    const r = await t.handler({}, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("no workspace folder is open");
  });

  it("informs when durable memory does not exist", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readFileContent: vi.fn() };
    const t = createMemoryGetTool(fs as any);
    const r = await t.handler({}, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("No durable memory");
    expect(fs.readFileContent).not.toHaveBeenCalled();
  });

  it("reads durable memory by default", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFileContent: vi.fn().mockResolvedValue({ content: "DURABLE BODY" }),
    };
    const t = createMemoryGetTool(fs as any);
    const r = await t.handler({}, token);
    expect(r.content).toContain("Durable memory");
    expect(r.content).toContain("DURABLE BODY");
    expect(fs.readFileContent).toHaveBeenCalledWith(".parallx/memory/MEMORY.md");
  });

  it("validates daily date format", async () => {
    const fs = { exists: vi.fn(), readFileContent: vi.fn() };
    const t = createMemoryGetTool(fs as any);
    const r = await t.handler({ layer: "daily", date: "2025/01/01" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("YYYY-MM-DD");
  });

  it("reads daily memory at requested date path", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFileContent: vi.fn().mockResolvedValue({ content: "DAILY BODY" }),
    };
    const t = createMemoryGetTool(fs as any);
    const r = await t.handler({ layer: "daily", date: "2025-01-15" }, token);
    expect(fs.readFileContent).toHaveBeenCalledWith(".parallx/memory/2025-01-15.md");
    expect(r.content).toContain("DAILY BODY");
  });

  it("informs when daily memory absent for date", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readFileContent: vi.fn() };
    const t = createMemoryGetTool(fs as any);
    const r = await t.handler({ layer: "daily", date: "2025-01-15" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("No daily memory recorded for 2025-01-15");
  });
});

describe("memory_search tool", () => {
  it("declares stable name + required query", () => {
    const t = createMemorySearchTool(undefined);
    expect(t.name).toBe("memory_search");
    expect(t.parameters.required).toEqual(["query"]);
  });

  it("errors when memorySearch is undefined", async () => {
    const t = createMemorySearchTool(undefined);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("retrieval service has not been initialized");
  });

  it("reports not-ready when index still building (non-error)", async () => {
    const svc = { isReady: () => false, search: vi.fn() };
    const t = createMemorySearchTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("still in progress");
    expect(svc.search).not.toHaveBeenCalled();
  });

  it("errors on empty query", async () => {
    const svc = { isReady: () => true, search: vi.fn() };
    const t = createMemorySearchTool(svc as any);
    const r = await t.handler({ query: "   " }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Search query is empty");
  });

  it("returns no-results message when search yields []", async () => {
    const svc = { isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const t = createMemorySearchTool(svc as any);
    const r = await t.handler({ query: "foo" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain('No canonical memory results found for "foo"');
  });

  it("formats matches with score + path + body", async () => {
    const svc = {
      isReady: () => true,
      search: vi.fn().mockResolvedValue([
        { sourceId: ".parallx/memory/MEMORY.md", contextPrefix: "Section A", text: "alpha text", score: 0.87 },
        { sourceId: ".parallx/memory/2025-01-15.md", contextPrefix: "", text: "daily text", score: 0.50 },
      ]),
    };
    const t = createMemorySearchTool(svc as any);
    const r = await t.handler({ query: "x", layer: "all" }, token);
    expect(r.content).toContain("Found 2 canonical memory result");
    expect(r.content).toContain("Durable Memory");
    expect(r.content).toContain("Daily Memory");
    expect(r.content).toContain("0.870");
    expect(r.content).toContain("alpha text");
  });

  it("forwards layer + date filters to search", async () => {
    const svc = { isReady: () => true, search: vi.fn().mockResolvedValue([]) };
    const t = createMemorySearchTool(svc as any);
    await t.handler({ query: "topic", layer: "daily", date: "2025-01-15" }, token);
    expect(svc.search).toHaveBeenCalledWith("topic", { layer: "daily", date: "2025-01-15" });
  });

  it("rejects malformed date filter", async () => {
    const svc = { isReady: () => true, search: vi.fn() };
    const t = createMemorySearchTool(svc as any);
    const r = await t.handler({ query: "x", date: "bad" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("YYYY-MM-DD");
  });
});
