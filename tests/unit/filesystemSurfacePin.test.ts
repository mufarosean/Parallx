/**
 * Pin tests for FilesystemSurfacePlugin — invariant guards.
 *
 * Pins:
 *   - isAvailable() requires a workspace folder
 *   - deliver() requires metadata.path
 *   - rejects absolute paths unless metadata.allowAbsolute === true
 *   - rejects path traversal ("..")
 *   - serializes structured content as JSON; passes text content through
 *   - writes to IFileService.writeFile with a URI resolved against first folder
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilesystemSurfacePlugin } from "../../src/services/surfaces/filesystemSurface";
import { URI } from "../../src/platform/uri";
import {
  SURFACE_FILESYSTEM,
  type ISurfaceDelivery,
} from "../../src/openclaw/openclawSurfacePlugin";

function makeDelivery(overrides: Partial<ISurfaceDelivery> = {}): ISurfaceDelivery {
  return {
    id: "d1",
    surfaceId: SURFACE_FILESYSTEM,
    contentType: "text",
    content: "hello",
    metadata: { path: "notes/out.txt" },
    createdAt: 0,
    status: "pending",
    retries: 0,
    error: null,
    ...overrides,
  } as ISurfaceDelivery;
}

function makeFs() {
  return { writeFile: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeWs(folderFsPath: string | undefined) {
  if (folderFsPath === undefined) return { folders: [] } as any;
  return { folders: [{ uri: URI.file(folderFsPath) }] } as any;
}

describe("FilesystemSurfacePlugin — invariants", () => {
  let fs: ReturnType<typeof makeFs>;
  beforeEach(() => { fs = makeFs(); });

  it("isAvailable returns false when no workspace folders", () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs(undefined));
    expect(p.isAvailable()).toBe(false);
  });

  it("isAvailable returns true when at least one workspace folder is present", () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    expect(p.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when workspaceService is undefined", () => {
    const p = new FilesystemSurfacePlugin(fs, undefined as any);
    expect(p.isAvailable()).toBe(false);
  });

  it("deliver throws when surface is not available", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs(undefined));
    await expect(p.deliver(makeDelivery())).rejects.toThrow(/not available/i);
  });

  it("deliver throws when metadata.path is missing", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await expect(p.deliver(makeDelivery({ metadata: {} }))).rejects.toThrow(/metadata\.path/i);
  });

  it("deliver throws on absolute path unless allowAbsolute=true (Windows drive)", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await expect(
      p.deliver(makeDelivery({ metadata: { path: "C:\\evil.txt" } }))
    ).rejects.toThrow(/absolute paths not allowed/i);
  });

  it("deliver throws on absolute path unless allowAbsolute=true (POSIX)", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await expect(
      p.deliver(makeDelivery({ metadata: { path: "/etc/passwd" } }))
    ).rejects.toThrow(/absolute paths not allowed/i);
  });

  it("deliver accepts absolute path when allowAbsolute=true", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    const ok = await p.deliver(makeDelivery({
      metadata: { path: "D:/abs/file.txt", allowAbsolute: true },
    }));
    expect(ok).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [uri, body] = fs.writeFile.mock.calls[0];
    expect(uri.fsPath.toLowerCase().replace(/\\/g, "/")).toContain("abs/file.txt");
    expect(body).toBe("hello");
  });

  it("deliver rejects path traversal even in relative paths", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await expect(
      p.deliver(makeDelivery({ metadata: { path: "../escape.txt" } }))
    ).rejects.toThrow(/traversal not allowed/i);
  });

  it("deliver resolves relative path against first workspace folder", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await p.deliver(makeDelivery({ metadata: { path: "notes/out.txt" } }));
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [uri, body] = fs.writeFile.mock.calls[0];
    const norm = uri.fsPath.replace(/\\/g, "/").toLowerCase();
    expect(norm.endsWith("/ws/notes/out.txt")).toBe(true);
    expect(body).toBe("hello");
  });

  it("deliver normalizes backslashes in relative path segments", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await p.deliver(makeDelivery({ metadata: { path: "a\\b\\c.txt" } }));
    const [uri] = fs.writeFile.mock.calls[0];
    const norm = uri.fsPath.replace(/\\/g, "/").toLowerCase();
    expect(norm.endsWith("/ws/a/b/c.txt")).toBe(true);
  });

  it("deliver strips trailing slashes from the workspace folder before joining", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws/"));
    await p.deliver(makeDelivery({ metadata: { path: "out.txt" } }));
    const [uri] = fs.writeFile.mock.calls[0];
    const norm = uri.fsPath.replace(/\\/g, "/").toLowerCase();
    // No double slash artifact between ws and out.txt
    expect(norm.includes("ws//out.txt")).toBe(false);
    expect(norm.endsWith("/ws/out.txt")).toBe(true);
  });

  it("deliver serializes structured content as pretty JSON", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    const payload = { a: 1, b: [2, 3] };
    await p.deliver(makeDelivery({ contentType: "structured", content: payload }));
    const [, body] = fs.writeFile.mock.calls[0];
    expect(body).toBe(JSON.stringify(payload, null, 2));
  });

  it("deliver coerces non-string text content via String()", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await p.deliver(makeDelivery({ contentType: "text", content: 42 as any }));
    const [, body] = fs.writeFile.mock.calls[0];
    expect(body).toBe("42");
  });

  it("deliver coerces undefined text content to empty string", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    await p.deliver(makeDelivery({ contentType: "text", content: undefined as any }));
    const [, body] = fs.writeFile.mock.calls[0];
    expect(body).toBe("");
  });

  it("deliver returns true on success and calls writeFile exactly once", async () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    const ok = await p.deliver(makeDelivery());
    expect(ok).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it("capabilities advertise text+structured, not binary or actions", () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    expect(p.capabilities.supportsText).toBe(true);
    expect(p.capabilities.supportsStructured).toBe(true);
    expect(p.capabilities.supportsBinary).toBe(false);
    expect(p.capabilities.supportsActions).toBe(false);
    expect(p.id).toBe(SURFACE_FILESYSTEM);
  });

  it("dispose is a no-op (does not throw)", () => {
    const p = new FilesystemSurfacePlugin(fs, makeWs("D:/ws"));
    expect(() => p.dispose()).not.toThrow();
  });
});
