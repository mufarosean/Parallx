// capabilityFsBridgePin.test.ts — pin CapabilityFsBridge scope/mode/path-traversal.

import { describe, it, expect, vi } from "vitest";
import { CapabilityFsBridge } from "../../src/api/bridges/capabilityFsBridge";
import { URI } from "../../src/platform/uri";

function makeFs() {
  return {
    readFile: vi.fn(async () => ({ content: "x", encoding: "utf8" })),
    writeFile: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ type: 1, size: 7, ctime: 0, mtime: 42 })),
    readdir: vi.fn(async () => [{ name: "a", type: 1 } as any]),
    exists: vi.fn(async () => true),
    rename: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  } as any;
}

const ws = URI.file("D:/work");

describe("CapabilityFsBridge — mode enforcement", () => {
  it("read mode allows readFile, blocks writeFile", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.ext", "workspace-read", ["read"], fs, () => [ws]);
    await b.readFile("file:///D:/work/a.txt");
    await expect(b.writeFile("file:///D:/work/a.txt", "x")).rejects.toThrow(/does not have "write"/);
  });

  it("write mode is required for writeFile/rename/delete/mkdir", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.ext", "workspace-files", ["read"], fs, () => [ws]);
    await expect(b.rename("file:///D:/work/a", "file:///D:/work/b")).rejects.toThrow(/does not have "write"/);
    await expect(b.delete("file:///D:/work/a")).rejects.toThrow(/does not have "write"/);
    await expect(b.mkdir("file:///D:/work/a")).rejects.toThrow(/does not have "write"/);
  });
});

describe("CapabilityFsBridge — scope: workspace-*", () => {
  it("rejects non-file:// URIs", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-read", ["read"], fs, () => [ws]);
    await expect(b.readFile("http://x/y")).rejects.toThrow(/Only file:\/\//);
  });

  it("rejects URIs outside workspace folders", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-read", ["read"], fs, () => [ws]);
    await expect(b.readFile("file:///D:/elsewhere/a.txt")).rejects.toThrow(/outside workspace folders/);
  });

  it("rejects when no workspace is open", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-read", ["read"], fs, () => []);
    await expect(b.readFile("file:///D:/work/a.txt")).rejects.toThrow(/No workspace folders open/);
  });

  it("readFile returns content with encoding 'utf-8'", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-read", ["read"], fs, () => [ws]);
    const r = await b.readFile("file:///D:/work/a.txt");
    expect(r).toEqual({ content: "x", encoding: "utf-8" });
  });

  it("stat returns subset {type,size,mtime}", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-read", ["read"], fs, () => [ws]);
    const r = await b.stat("file:///D:/work/a.txt");
    expect(r).toEqual({ type: 1, size: 7, mtime: 42 });
  });

  it("delete uses useTrash:'auto'", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("p.e", "workspace-files", ["read", "write"], fs, () => [ws]);
    await b.delete("file:///D:/work/a.txt");
    expect(fs.delete.mock.calls[0][1]).toEqual({ useTrash: "auto" });
  });
});

describe("CapabilityFsBridge — scope: extension-data", () => {
  it("relative path is resolved under <ws>/.parallx/extensions/<ext>", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.media-organizer", "extension-data", ["read", "write"], fs, () => [ws]);
    await b.writeFile("settings.json", "{}");
    const calledUri: URI = fs.writeFile.mock.calls[0][0];
    expect(calledUri.fsPath.replace(/\\/g, "/").toLowerCase()).toBe("d:/work/.parallx/extensions/media-organizer/settings.json");
  });

  it("rejects paths that escape the data directory", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.media-organizer", "extension-data", ["read"], fs, () => [ws]);
    // Pass an absolute file URI outside the data dir.
    await expect(b.readFile("file:///D:/work/other/a.txt")).rejects.toThrow(/outside its data directory/);
  });

  it("rejects '..' path traversal segments (M67 guard)", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.media-organizer", "extension-data", ["read"], fs, () => [ws]);
    await expect(b.readFile("../../etc/passwd")).rejects.toThrow(/'\.\.' segments/);
  });

  it("throws when no workspace open and using extension-data scope", async () => {
    const fs = makeFs();
    const b = new CapabilityFsBridge("publisher.x", "extension-data", ["read"], fs, () => []);
    await expect(b.readFile("a.txt")).rejects.toThrow(/No workspace open/);
  });
});
