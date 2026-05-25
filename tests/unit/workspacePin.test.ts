/**
 * Pin: workspace/Workspace class — identity, metadata, folder management,
 * state classification, displayName resolution, serialization round-trip.
 */
import { describe, it, expect, vi } from "vitest";
import { Workspace } from "../../src/workspace/workspace";
import { WorkbenchState, WORKSPACE_STATE_VERSION } from "../../src/workspace/workspaceTypes";
import { URI } from "../../src/platform/uri";

describe("workspace/Workspace — identity + factory", () => {
  it("Workspace.create assigns a fresh UUID + uses provided name/path/iconOrColor", () => {
    const a = Workspace.create("My Notes", "/tmp/notes", "blue");
    const b = Workspace.create("My Notes", "/tmp/notes", "blue");
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe("My Notes");
    expect(a.path).toBe("/tmp/notes");
    expect(a.iconOrColor).toBe("blue");
    expect(typeof a.createdAt).toBe("string");
    expect(typeof a.lastAccessedAt).toBe("string");
  });

  it("Workspace.fromSerialized restores identity + metadata exactly", () => {
    const md = { createdAt: "2024-01-01T00:00:00.000Z", lastAccessedAt: "2024-01-02T00:00:00.000Z" };
    const ws = Workspace.fromSerialized({ id: "abc", name: "W", path: "/w", iconOrColor: "red" }, md);
    expect(ws.id).toBe("abc");
    expect(ws.name).toBe("W");
    expect(ws.path).toBe("/w");
    expect(ws.iconOrColor).toBe("red");
    expect(ws.metadata).toEqual(md);
  });

  it("adoptId replaces the identity id only when different and truthy", () => {
    const ws = Workspace.create("X");
    const original = ws.id;
    ws.adoptId(""); // falsy → no-op
    expect(ws.id).toBe(original);
    ws.adoptId(original); // same → no-op
    expect(ws.id).toBe(original);
    ws.adoptId("durable-1");
    expect(ws.id).toBe("durable-1");
    expect(ws.name).toBe("X"); // other identity fields preserved
  });

  it("rename fires onDidRename with the new name", () => {
    const ws = Workspace.create("Old");
    const spy = vi.fn();
    ws.onDidRename(spy);
    ws.rename("New");
    expect(ws.name).toBe("New");
    expect(spy).toHaveBeenCalledWith("New");
  });

  it("setIconOrColor updates and tolerates undefined to clear", () => {
    const ws = Workspace.create("X", undefined, "blue");
    ws.setIconOrColor("green");
    expect(ws.iconOrColor).toBe("green");
    ws.setIconOrColor(undefined);
    expect(ws.iconOrColor).toBeUndefined();
  });

  it("equals compares by identity.id (name/path differences ignored)", () => {
    const a = Workspace.fromSerialized({ id: "k", name: "A" }, { createdAt: "x", lastAccessedAt: "x" });
    const b = Workspace.fromSerialized({ id: "k", name: "B" }, { createdAt: "y", lastAccessedAt: "y" });
    const c = Workspace.fromSerialized({ id: "j", name: "A" }, { createdAt: "x", lastAccessedAt: "x" });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("touch advances lastAccessedAt", () => {
    const ws = Workspace.fromSerialized(
      { id: "1", name: "X" },
      { createdAt: "2020-01-01T00:00:00.000Z", lastAccessedAt: "2020-01-01T00:00:00.000Z" }
    );
    const before = ws.lastAccessedAt;
    ws.touch();
    expect(ws.lastAccessedAt).not.toBe(before);
    expect(ws.createdAt).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("workspace/Workspace — folders + state", () => {
  it("state is EMPTY with no folders, FOLDER with at least one", () => {
    const ws = Workspace.create("X");
    expect(ws.state).toBe(WorkbenchState.EMPTY);
    ws.addFolder(URI.file("/tmp/a"));
    expect(ws.state).toBe(WorkbenchState.FOLDER);
  });

  it("addFolder rejects a second folder (single-folder-only) and returns undefined", () => {
    const ws = Workspace.create("X");
    const first = ws.addFolder(URI.file("/tmp/a"));
    expect(first?.name).toBe("a");
    const second = ws.addFolder(URI.file("/tmp/b"));
    expect(second).toBeUndefined();
    expect(ws.folders.length).toBe(1);
  });

  it("addFolder duplicate (same URI key) returns undefined without firing change events on the second call", () => {
    const ws = Workspace.create("X");
    ws.addFolder(URI.file("/tmp/a"));
    const spy = vi.fn();
    ws.onDidChangeFolders(spy);
    const again = ws.addFolder(URI.file("/tmp/a"));
    expect(again).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("addFolder fires onDidChangeFolders + onDidChangeState (EMPTY → FOLDER)", () => {
    const ws = Workspace.create("X");
    const stateSpy = vi.fn();
    const foldersSpy = vi.fn();
    ws.onDidChangeState(stateSpy);
    ws.onDidChangeFolders(foldersSpy);
    ws.addFolder(URI.file("/tmp/a"), "alpha");
    expect(foldersSpy).toHaveBeenCalledTimes(1);
    expect(foldersSpy.mock.calls[0][0].added[0].name).toBe("alpha");
    expect(stateSpy).toHaveBeenCalledWith(WorkbenchState.FOLDER);
  });

  it("removeFolder removes by URI key, fires events, reindexes; missing → false", () => {
    const ws = Workspace.create("X");
    ws.addFolder(URI.file("/tmp/a"));
    const stateSpy = vi.fn();
    ws.onDidChangeState(stateSpy);
    expect(ws.removeFolder(URI.file("/tmp/missing"))).toBe(false);
    expect(stateSpy).not.toHaveBeenCalled();
    expect(ws.removeFolder(URI.file("/tmp/a"))).toBe(true);
    expect(ws.folders.length).toBe(0);
    expect(stateSpy).toHaveBeenCalledWith(WorkbenchState.EMPTY);
  });

  it("setFolders replaces wholesale and reindexes; reorderFolders is a no-op", () => {
    const ws = Workspace.create("X");
    ws.setFolders([{ uri: URI.file("/tmp/a"), name: "a", index: 0 }]);
    expect(ws.folders.map((f) => f.name)).toEqual(["a"]);
    expect(ws.folders[0].index).toBe(0);
    ws.reorderFolders([URI.file("/tmp/z")]); // no-op
    expect(ws.folders.map((f) => f.name)).toEqual(["a"]);
  });

  it("displayName: empty → identity.name; single folder → folder.name when identity matches, else identity.name (W11)", () => {
    const ws = Workspace.create("books", undefined);
    expect(ws.displayName).toBe("books");
    ws.addFolder(URI.file("/tmp/books"), "books");
    expect(ws.displayName).toBe("books");

    // Diverged identity (user rename) wins over folder.name.
    const ws2 = Workspace.create("Identity", undefined);
    ws2.addFolder(URI.file("/tmp/books"), "Books");
    expect(ws2.displayName).toBe("Identity");
  });

  it("getWorkspaceFolder matches the folder for an exact path AND descendants (case-insensitive)", () => {
    const ws = Workspace.create("X");
    ws.addFolder(URI.file("/tmp/notes"), "notes");
    expect(ws.getWorkspaceFolder(URI.file("/tmp/notes"))?.name).toBe("notes");
    expect(ws.getWorkspaceFolder(URI.file("/tmp/notes/sub/file.md"))?.name).toBe("notes");
    expect(ws.getWorkspaceFolder(URI.file("/elsewhere/file.md"))).toBeUndefined();
  });
});

describe("workspace/Workspace — serialization + dispose", () => {
  it("serializeFolders + restoreFolders round-trip", () => {
    const ws = Workspace.create("X");
    ws.addFolder(URI.file("/tmp/notes"), "Notes");
    const serialized = ws.serializeFolders();
    expect(serialized[0]).toMatchObject({ name: "Notes", scheme: "file" });

    const restored = Workspace.create("Y");
    restored.restoreFolders(serialized);
    expect(restored.folders.length).toBe(1);
    expect(restored.folders[0].name).toBe("Notes");
    expect(restored.folders[0].uri.scheme).toBe("file");
  });

  it("createDefaultState emits the canonical WORKSPACE_STATE_VERSION + includes folders", () => {
    const ws = Workspace.create("X");
    ws.addFolder(URI.file("/tmp/notes"), "Notes");
    const state = ws.createDefaultState(800, 600);
    expect(state.version).toBe(WORKSPACE_STATE_VERSION);
    expect(state.identity.name).toBe("X");
    expect(state.folders).toEqual([{ scheme: "file", path: ws.folders[0].uri.path, name: "Notes" }]);
    expect(Array.isArray(state.parts)).toBe(true);
    expect(Array.isArray(state.viewContainers)).toBe(true);
    expect(Array.isArray(state.views)).toBe(true);
  });

  it("dispose is idempotent — second call is a safe no-op", () => {
    const ws = Workspace.create("X");
    ws.dispose();
    expect(() => ws.dispose()).not.toThrow();
  });
});
