/**
 * Pin-the-invariant: tools/writeTools — write_file, edit_file, delete_file.
 * Focus: path sanitization + guard rails + handler delegations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWriteFileTool,
  createEditFileTool,
  createDeleteFileTool,
} from "../../src/built-in/chat/tools/writeTools";

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

function fakeWriter() {
  return {
    isPathAllowed: vi.fn().mockReturnValue(true),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
}
function fakeFs(content = "alpha\nbeta\ngamma\n", exists = true) {
  return {
    exists: vi.fn().mockResolvedValue(exists),
    readFileContent: vi.fn().mockResolvedValue({ content }),
  };
}

describe("write_file tool", () => {
  it("declares stable name + requires approval", () => {
    const t = createWriteFileTool(undefined, undefined);
    expect(t.name).toBe("write_file");
    expect(t.requiresConfirmation).toBe(true);
    expect(t.permissionLevel).toBe("requires-approval");
    expect(t.parameters.required).toEqual(["path", "content"]);
  });

  it("throws when writer is undefined", async () => {
    const t = createWriteFileTool(undefined, undefined);
    await expect(t.handler({ path: "a.txt", content: "x" }, token)).rejects.toThrow(/File writer is not available/);
  });

  it("rejects empty path", async () => {
    const writer = fakeWriter();
    const t = createWriteFileTool(fakeFs() as any, writer as any);
    const r = await t.handler({ path: "", content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toBe("path is required");
  });

  it("rejects absolute path", async () => {
    const writer = fakeWriter();
    const t = createWriteFileTool(fakeFs() as any, writer as any);
    const r = await t.handler({ path: "C:/secret.txt", content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Absolute paths are not allowed");
  });

  it("rejects path traversal", async () => {
    const writer = fakeWriter();
    const t = createWriteFileTool(fakeFs() as any, writer as any);
    const r = await t.handler({ path: "../escape.txt", content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Path traversal");
  });

  it("rejects ignored paths via writer.isPathAllowed", async () => {
    const writer = fakeWriter();
    writer.isPathAllowed.mockReturnValue(false);
    const t = createWriteFileTool(fakeFs() as any, writer as any);
    const r = await t.handler({ path: "secret.env", content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain(".parallxignore");
  });

  it("writes new file with Created label when not pre-existing", async () => {
    const writer = fakeWriter();
    const fs = fakeFs("", false);
    const t = createWriteFileTool(fs as any, writer as any);
    const r = await t.handler({ path: "new.txt", content: "hello\nworld" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Created");
    expect(writer.writeFile).toHaveBeenCalledWith("new.txt", "hello\nworld");
  });

  it("writes existing file with Overwrote label", async () => {
    const writer = fakeWriter();
    const fs = fakeFs("old", true);
    const t = createWriteFileTool(fs as any, writer as any);
    const r = await t.handler({ path: "old.txt", content: "new" }, token);
    expect(r.content).toContain("Overwrote");
  });

  it("normalizes leading './' from path", async () => {
    const writer = fakeWriter();
    const t = createWriteFileTool(fakeFs() as any, writer as any);
    await t.handler({ path: "./sub/x.txt", content: "y" }, token);
    expect(writer.writeFile).toHaveBeenCalledWith("sub/x.txt", "y");
  });
});

describe("edit_file tool", () => {
  it("declares stable required params", () => {
    const t = createEditFileTool(undefined, undefined);
    expect(t.name).toBe("edit_file");
    expect(t.parameters.required).toEqual(["path", "old_content", "new_content"]);
  });

  it("errors when old_content is missing", async () => {
    const t = createEditFileTool(fakeFs() as any, fakeWriter() as any);
    const r = await t.handler({ path: "f.txt", old_content: "", new_content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("old_content is required");
  });

  it("errors when old_content not found", async () => {
    const t = createEditFileTool(fakeFs("nothing here") as any, fakeWriter() as any);
    const r = await t.handler({ path: "f.txt", old_content: "missing", new_content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Could not find");
  });

  it("errors on ambiguous (multi-match) old_content", async () => {
    const t = createEditFileTool(fakeFs("dup\nmid\ndup\n") as any, fakeWriter() as any);
    const r = await t.handler({ path: "f.txt", old_content: "dup", new_content: "x" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("multiple locations");
  });

  it("replaces unique match and reports line delta", async () => {
    const writer = fakeWriter();
    const t = createEditFileTool(fakeFs("a\nbeta\nc\n") as any, writer as any);
    const r = await t.handler({ path: "f.txt", old_content: "beta", new_content: "BETA\nMORE" }, token);
    expect(r.isError).toBeUndefined();
    expect(writer.writeFile).toHaveBeenCalledWith("f.txt", "a\nBETA\nMORE\nc\n");
    expect(r.content).toContain("Edited");
  });
});

describe("delete_file tool", () => {
  beforeEach(() => {
    delete (globalThis as any).parallxElectron;
  });
  afterEach(() => {
    delete (globalThis as any).parallxElectron;
  });

  it("declares stable name + requires approval", () => {
    const t = createDeleteFileTool(undefined, undefined);
    expect(t.name).toBe("delete_file");
    expect(t.requiresConfirmation).toBe(true);
  });

  it("throws when fs is undefined", async () => {
    const t = createDeleteFileTool(undefined, fakeWriter() as any);
    await expect(t.handler({ path: "x" }, token)).rejects.toThrow(/File system is not available/);
  });

  it("errors when path empty", async () => {
    const t = createDeleteFileTool(fakeFs() as any, fakeWriter() as any);
    const r = await t.handler({ path: "" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toBe("path is required");
  });

  it("errors when file does not exist", async () => {
    const t = createDeleteFileTool(fakeFs("", false) as any, fakeWriter() as any);
    const r = await t.handler({ path: "missing.txt" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("does not exist");
  });

  it("errors when no fs bridge available", async () => {
    const t = createDeleteFileTool(fakeFs() as any, fakeWriter() as any);
    const r = await t.handler({ path: "exists.txt" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("no file system bridge");
  });

  it("delegates to electron bridge when present and reports success", async () => {
    const del = vi.fn().mockResolvedValue({ error: null });
    (globalThis as any).parallxElectron = { fs: { delete: del } };
    const t = createDeleteFileTool(fakeFs() as any, fakeWriter() as any);
    const r = await t.handler({ path: "exists.txt" }, token);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Deleted");
    expect(del).toHaveBeenCalled();
  });

  it("surfaces bridge errors", async () => {
    (globalThis as any).parallxElectron = { fs: { delete: vi.fn().mockResolvedValue({ error: { code: "EACCES", message: "no perm" } }) } };
    const t = createDeleteFileTool(fakeFs() as any, fakeWriter() as any);
    const r = await t.handler({ path: "exists.txt" }, token);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("no perm");
  });
});
