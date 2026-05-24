// fileSystemBridgePin.test.ts — pin FileSystemBridge scoping + lifecycle.

import { describe, it, expect, vi } from "vitest";
import { FileSystemBridge } from "../../src/api/bridges/fileSystemBridge";
import { URI } from "../../src/platform/uri";

function makeFs() {
  return {
    readFile: vi.fn(async (_u: URI) => ({ content: "data", encoding: "utf8" })),
    writeFile: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ type: "file", size: 0, ctime: 0, mtime: 0 })),
    readdir: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    delete: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  } as any;
}

const folder = URI.file("D:/workspace");
const inside = URI.file("D:/workspace/sub/file.txt");
const outside = URI.file("D:/elsewhere/file.txt");

describe("FileSystemBridge — happy path", () => {
  it("readFile returns the underlying content string", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    const out = await b.readFile(inside);
    expect(out).toBe("data");
    expect(fs.readFile).toHaveBeenCalledWith(inside);
  });

  it("writeFile/stat/readdir/exists/createDirectory delegate through fileService", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    await b.writeFile(inside, "x");
    await b.stat(inside);
    await b.readdir(inside);
    await b.exists(inside);
    await b.createDirectory(inside);
    expect(fs.writeFile).toHaveBeenCalledWith(inside, "x");
    expect(fs.stat).toHaveBeenCalledWith(inside);
    expect(fs.readdir).toHaveBeenCalledWith(inside);
    expect(fs.exists).toHaveBeenCalledWith(inside);
    expect(fs.mkdir).toHaveBeenCalledWith(inside);
  });

  it("delete uses trash='auto' by default", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    await b.delete(inside);
    expect(fs.delete).toHaveBeenCalledWith(inside, { useTrash: "auto" });
  });

  it("rename validates both source and target", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    const other = URI.file("D:/workspace/sub/file2.txt");
    await b.rename(inside, other);
    expect(fs.rename).toHaveBeenCalledWith(inside, other);
  });
});

describe("FileSystemBridge — scope validation (no boundary service)", () => {
  it("rejects non-file:// schemes", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    const httpUri = URI.parse("http://example.com/a");
    await expect(b.readFile(httpUri)).rejects.toThrow(/Only file:\/\//);
  });

  it("rejects when no workspace folders are open", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => []);
    await expect(b.readFile(inside)).rejects.toThrow(/No workspace folders open/);
  });

  it("rejects access outside workspace folders", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.guard", fs, () => [folder]);
    await expect(b.readFile(outside)).rejects.toThrow(/outside workspace folders/);
  });

  it("rename rejects when target is outside workspace", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.a", fs, () => [folder]);
    await expect(b.rename(inside, outside)).rejects.toThrow(/outside workspace folders/);
  });
});

describe("FileSystemBridge — boundary service path", () => {
  it("delegates scope check to the boundary service when provided", async () => {
    const fs = makeFs();
    const assertUriWithinWorkspace = vi.fn();
    const boundary: any = { assertUriWithinWorkspace };
    const b = new FileSystemBridge("tool.a", fs, () => [folder], boundary);
    await b.readFile(inside);
    expect(assertUriWithinWorkspace).toHaveBeenCalledWith(inside, 'Tool "tool.a"');
  });

  it("propagates boundary service errors", async () => {
    const fs = makeFs();
    const boundary: any = {
      assertUriWithinWorkspace: () => { throw new Error("denied"); },
    };
    const b = new FileSystemBridge("tool.a", fs, () => [folder], boundary);
    await expect(b.readFile(inside)).rejects.toThrow(/denied/);
  });
});

describe("FileSystemBridge — lifecycle", () => {
  it("after dispose, every op throws with the tool id", async () => {
    const fs = makeFs();
    const b = new FileSystemBridge("tool.dead", fs, () => [folder]);
    b.dispose();
    await expect(b.readFile(inside)).rejects.toThrow(/tool.dead/);
    await expect(b.writeFile(inside, "x")).rejects.toThrow(/tool.dead/);
    await expect(b.stat(inside)).rejects.toThrow(/tool.dead/);
    await expect(b.readdir(inside)).rejects.toThrow(/tool.dead/);
    await expect(b.exists(inside)).rejects.toThrow(/tool.dead/);
    await expect(b.delete(inside)).rejects.toThrow(/tool.dead/);
    await expect(b.rename(inside, inside)).rejects.toThrow(/tool.dead/);
    await expect(b.createDirectory(inside)).rejects.toThrow(/tool.dead/);
  });
});
