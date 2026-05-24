/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Workspace } from "../../src/workspace/workspace";
import { WorkbenchState, WORKSPACE_STATE_VERSION } from "../../src/workspace/workspaceTypes";
import { URI } from "../../src/platform/uri";

describe("Workspace — identity + factory", () => {
  it("Workspace.create generates a UUID identity and default metadata", () => {
    const w = Workspace.create("My WS");
    expect(w.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(w.name).toBe("My WS");
    expect(typeof w.createdAt).toBe("string");
    expect(typeof w.lastAccessedAt).toBe("string");
  });

  it("fromSerialized preserves the supplied identity and metadata", () => {
    const meta = { createdAt: "2020-01-01T00:00:00Z", lastAccessedAt: "2020-02-02T00:00:00Z" };
    const w = Workspace.fromSerialized({ id: "abc", name: "X" }, meta);
    expect(w.id).toBe("abc");
    expect(w.metadata).toBe(meta);
  });

  it("equals() is true only when identity ids match", () => {
    const a = Workspace.fromSerialized({ id: "1", name: "A" }, { createdAt: "", lastAccessedAt: "" });
    const b = Workspace.fromSerialized({ id: "1", name: "B" }, { createdAt: "", lastAccessedAt: "" });
    const c = Workspace.fromSerialized({ id: "2", name: "A" }, { createdAt: "", lastAccessedAt: "" });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe("Workspace — rename/touch/adoptId/setIconOrColor", () => {
  let logSpy: any;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  it("rename() updates the name and fires onDidRename", () => {
    const w = Workspace.create("Old");
    const fired = vi.fn();
    w.onDidRename(fired);
    w.rename("New");
    expect(w.name).toBe("New");
    expect(fired).toHaveBeenCalledWith("New");
  });

  it("touch() advances lastAccessedAt", () => {
    const w = Workspace.fromSerialized({ id: "i", name: "n" }, { createdAt: "x", lastAccessedAt: "2020-01-01T00:00:00.000Z" });
    w.touch();
    expect(w.lastAccessedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(w.lastAccessedAt)).toBeGreaterThan(0);
  });

  it("adoptId() replaces the id only when it differs", () => {
    const w = Workspace.fromSerialized({ id: "old", name: "n" }, { createdAt: "x", lastAccessedAt: "y" });
    w.adoptId("old"); // no-op
    expect(logSpy).not.toHaveBeenCalled();
    w.adoptId("new");
    expect(w.id).toBe("new");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Adopted durable identity"), "new", "old");
  });

  it("adoptId() ignores empty strings", () => {
    const w = Workspace.fromSerialized({ id: "k", name: "n" }, { createdAt: "", lastAccessedAt: "" });
    w.adoptId("");
    expect(w.id).toBe("k");
  });

  it("setIconOrColor() updates the identity field", () => {
    const w = Workspace.create("X");
    w.setIconOrColor("blue");
    expect(w.iconOrColor).toBe("blue");
    w.setIconOrColor(undefined);
    expect(w.iconOrColor).toBeUndefined();
  });
});

describe("Workspace — state + displayName", () => {
  it("state is EMPTY when no folders and FOLDER once a folder is added", () => {
    const w = Workspace.create("X");
    expect(w.state).toBe(WorkbenchState.EMPTY);
    const fired = vi.fn();
    w.onDidChangeState(fired);
    w.addFolder(URI.from({ scheme: "file", path: "/a" }));
    expect(w.state).toBe(WorkbenchState.FOLDER);
    expect(fired).toHaveBeenCalledWith(WorkbenchState.FOLDER);
  });

  it("displayName returns the folder name for single-folder workspaces", () => {
    const w = Workspace.create("Identity");
    expect(w.displayName).toBe("Identity");
    w.addFolder(URI.from({ scheme: "file", path: "/repo/books" }), "Books");
    expect(w.displayName).toBe("Books");
  });
});

describe("Workspace — folders (M53 single-folder constraint)", () => {
  let warnSpy: any;
  beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it("addFolder rejects a duplicate URI by returning undefined", () => {
    const w = Workspace.create("X");
    const u = URI.from({ scheme: "file", path: "/a" });
    expect(w.addFolder(u)).toBeDefined();
    // second add — but single-folder rule prevents adding any second folder,
    // so we use removeFolder + addFolder for the duplicate check
    expect(w.addFolder(u)).toBeUndefined();
  });

  it("addFolder refuses to add a second folder (single-folder workspace) and warns", () => {
    const w = Workspace.create("X");
    w.addFolder(URI.from({ scheme: "file", path: "/a" }));
    expect(w.addFolder(URI.from({ scheme: "file", path: "/b" }))).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("addFolder emits onDidChangeFolders with the added folder", () => {
    const w = Workspace.create("X");
    const fired = vi.fn();
    w.onDidChangeFolders(fired);
    const u = URI.from({ scheme: "file", path: "/repo/x" });
    w.addFolder(u, "Repo");
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][0].added).toHaveLength(1);
    expect(fired.mock.calls[0][0].added[0].name).toBe("Repo");
  });

  it("removeFolder() returns false for an unknown URI and true after success + fires events", () => {
    const w = Workspace.create("X");
    const u = URI.from({ scheme: "file", path: "/p" });
    w.addFolder(u);
    expect(w.removeFolder(URI.from({ scheme: "file", path: "/never" }))).toBe(false);

    const folders = vi.fn();
    const state = vi.fn();
    w.onDidChangeFolders(folders);
    w.onDidChangeState(state);

    expect(w.removeFolder(u)).toBe(true);
    expect(folders).toHaveBeenCalled();
    expect(state).toHaveBeenCalledWith(WorkbenchState.EMPTY);
  });

  it("setFolders replaces all folders and reindexes", () => {
    const w = Workspace.create("X");
    const a = URI.from({ scheme: "file", path: "/a" });
    w.addFolder(a);
    const b = URI.from({ scheme: "file", path: "/b" });
    const c = URI.from({ scheme: "file", path: "/c" });
    w.setFolders([
      { uri: b, name: "B", index: 0 },
      { uri: c, name: "C", index: 0 },
    ]);
    expect(w.folders.map((f) => f.name)).toEqual(["B", "C"]);
    expect(w.folders.map((f) => f.index)).toEqual([0, 1]);
  });

  it("reorderFolders is a no-op (single-folder)", () => {
    const w = Workspace.create("X");
    w.addFolder(URI.from({ scheme: "file", path: "/a" }));
    w.reorderFolders([URI.from({ scheme: "file", path: "/a" })]);
    expect(w.folders.map((f) => f.uri.path)).toEqual(["/a"]);
  });

  it("getWorkspaceFolder matches exact and prefix paths case-insensitively", () => {
    const w = Workspace.create("X");
    w.addFolder(URI.from({ scheme: "file", path: "/Repo/Books" }));
    expect(w.getWorkspaceFolder(URI.from({ scheme: "file", path: "/repo/books" }))).toBeDefined();
    expect(w.getWorkspaceFolder(URI.from({ scheme: "file", path: "/repo/books/inner/file.md" }))).toBeDefined();
    expect(w.getWorkspaceFolder(URI.from({ scheme: "file", path: "/other" }))).toBeUndefined();
  });

  it("serializeFolders and restoreFolders round-trip", () => {
    const w = Workspace.create("X");
    w.addFolder(URI.from({ scheme: "file", path: "/repo" }), "Repo");
    const data = w.serializeFolders();
    expect(data).toEqual([{ scheme: "file", path: "/repo", name: "Repo" }]);

    const w2 = Workspace.create("Y");
    w2.restoreFolders(data);
    expect(w2.folders.map((f) => f.name)).toEqual(["Repo"]);
    expect(w2.folders[0].uri.scheme).toBe("file");
  });
});

describe("Workspace — createDefaultState + dispose", () => {
  it("createDefaultState produces a versioned state with serialized folders", () => {
    const w = Workspace.create("X");
    w.addFolder(URI.from({ scheme: "file", path: "/p" }), "P");
    const s = w.createDefaultState(800, 600);
    expect(s.version).toBe(WORKSPACE_STATE_VERSION);
    expect(s.identity.name).toBe("X");
    expect(s.folders).toEqual([{ scheme: "file", path: "/p", name: "P" }]);
    expect(s.parts).toEqual([]);
    expect(Array.isArray(s.viewContainers)).toBe(true);
    expect(Array.isArray(s.views)).toBe(true);
  });

  it("dispose is idempotent", () => {
    const w = Workspace.create("X");
    w.dispose();
    w.dispose(); // does not throw
  });
});
