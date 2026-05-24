/**
 * Pin-the-invariant: tools/fileTools — pure-handler subset.
 * Focuses on list_files (small), search_knowledge (no DOM).
 */
import { describe, it, expect, vi } from "vitest";
import {
  createListFilesTool,
  createSearchFilesTool,
  createSearchKnowledgeTool,
} from "../../src/built-in/chat/tools/fileTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

describe("list_files tool", () => {
  it("declares stable name + always-allowed", () => {
    const t = createListFilesTool(undefined);
    expect(t.name).toBe("list_files");
    expect(t.permissionLevel).toBe("always-allowed");
    expect(t.requiresConfirmation).toBe(false);
  });

  it("throws when fs is undefined (asserts contract)", async () => {
    const t = createListFilesTool(undefined);
    await expect(t.handler({}, token)).rejects.toThrow(/File system is not available/);
  });

  it("reports empty directory", async () => {
    const fs = { readdir: vi.fn().mockResolvedValue([]), workspaceRootName: "ws" };
    const t = createListFilesTool(fs as any);
    const r = await t.handler({ path: "." }, token);
    expect(r.content).toContain('Directory "." is empty');
  });

  it("lists entries with [dir]/[file] labels and size for files", async () => {
    const fs = {
      readdir: vi.fn().mockResolvedValue([
        { name: "sub", type: "directory", size: 0 },
        { name: "a.txt", type: "file", size: 1234 },
      ]),
      workspaceRootName: "ws",
    };
    const t = createListFilesTool(fs as any);
    const r = await t.handler({}, token);
    expect(r.content).toContain("[dir] sub");
    expect(r.content).toContain("[file] a.txt");
    expect(r.content).toContain("(1.2 KB)");
    expect(r.content).toContain('workspace "ws"');
  });

  it("surfaces readdir failures as isError", async () => {
    const fs = { readdir: vi.fn().mockRejectedValue(new Error("boom")), workspaceRootName: "ws" };
    const t = createListFilesTool(fs as any);
    const r = await t.handler({ path: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Failed to list");
  });
});

describe("search_files tool", () => {
  it("declares stable name + required pattern", () => {
    const t = createSearchFilesTool(undefined);
    expect(t.name).toBe("search_files");
    expect(t.parameters.required).toEqual(["pattern"]);
  });

  it("errors when pattern blank", async () => {
    const t = createSearchFilesTool({ readdir: vi.fn() } as any);
    const r = await t.handler({ pattern: "" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("pattern is required");
  });

  it("reports no matches", async () => {
    const fs = { readdir: vi.fn().mockResolvedValue([{ name: "x.ts", type: "file", size: 1 }]), workspaceRootName: "ws" };
    const t = createSearchFilesTool(fs as any);
    const r = await t.handler({ pattern: "missing" }, token);
    expect(r.content).toContain('No files found matching "missing"');
  });
});

describe("search_knowledge tool", () => {
  it("declares stable name + required query", () => {
    const t = createSearchKnowledgeTool(undefined);
    expect(t.name).toBe("search_knowledge");
    expect(t.parameters.required).toEqual(["query"]);
  });

  it("errors when retrieval undefined", async () => {
    const t = createSearchKnowledgeTool(undefined);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("retrieval service has not been initialized");
  });

  it("informs (non-error) when retrieval not ready", async () => {
    const svc = { isReady: () => false, retrieve: vi.fn() };
    const t = createSearchKnowledgeTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("indexing is still in progress");
    expect(svc.retrieve).not.toHaveBeenCalled();
  });

  it("errors on empty query", async () => {
    const svc = { isReady: () => true, retrieve: vi.fn() };
    const t = createSearchKnowledgeTool(svc as any);
    const r = await t.handler({ query: "   " }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("empty");
  });

  it("forwards source_filter + folder prefix to retrieve()", async () => {
    const svc = { isReady: () => true, retrieve: vi.fn().mockResolvedValue([]) };
    const t = createSearchKnowledgeTool(svc as any);
    await t.handler({ query: "topic", source_filter: "page_block", folder_path: "Docs" }, token);
    expect(svc.retrieve).toHaveBeenCalledWith("topic", "page_block", ["Docs/"]);
  });

  it("appends trailing slash to folder prefix only when missing", async () => {
    const svc = { isReady: () => true, retrieve: vi.fn().mockResolvedValue([]) };
    const t = createSearchKnowledgeTool(svc as any);
    await t.handler({ query: "topic", folder_path: "Docs/" }, token);
    expect(svc.retrieve).toHaveBeenCalledWith("topic", undefined, ["Docs/"]);
  });

  it("returns no-results message when retrieve yields []", async () => {
    const svc = { isReady: () => true, retrieve: vi.fn().mockResolvedValue([]) };
    const t = createSearchKnowledgeTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.content).toContain('No relevant results found for "x"');
  });

  it("formats matches with index + (Page|File) + score + body", async () => {
    const svc = {
      isReady: () => true,
      retrieve: vi.fn().mockResolvedValue([
        { sourceId: "page-1", contextPrefix: "Page A", text: "alpha", score: 0.91, sourceType: "page_block" },
        { sourceId: "/file.txt", contextPrefix: "", text: "beta", score: 0.55, sourceType: "file_chunk" },
      ]),
    };
    const t = createSearchKnowledgeTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.content).toContain("Found 2 relevant results");
    expect(r.content).toContain("(Page)");
    expect(r.content).toContain("(File)");
    expect(r.content).toContain("0.910");
    expect(r.content).toContain("alpha");
  });

  it("surfaces retrieve throw as isError", async () => {
    const svc = { isReady: () => true, retrieve: vi.fn().mockRejectedValue(new Error("idx fail")) };
    const t = createSearchKnowledgeTool(svc as any);
    const r = await t.handler({ query: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("idx fail");
  });
});
