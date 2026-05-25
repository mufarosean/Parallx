/**
 * Pin: WorkspaceBridge — surface of parallx.workspace exposed to tools.
 *
 * Covers: fallback shapes when no deps wired, configuration forwarding,
 * folder/workspace/rename/file/canvas-page event mapping (internal →
 * serialized), serialization helpers, dispose semantics.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Emitter } from "../../src/platform/events";
import { URI } from "../../src/platform/uri";
import { WorkspaceBridge } from "../../src/api/bridges/workspaceBridge";

describe("WorkspaceBridge — fallback (no deps wired)", () => {
  let bridge: WorkspaceBridge;
  beforeEach(() => {
    bridge = new WorkspaceBridge("t", []);
  });

  it("workspaceFolders === undefined when no workspaceService", () => {
    expect(bridge.workspaceFolders).toBeUndefined();
  });

  it("getWorkspaceFolder returns undefined when no workspaceService", () => {
    expect(bridge.getWorkspaceFolder("file:///x")).toBeUndefined();
  });

  it("name returns undefined when no workspaceService", () => {
    expect(bridge.name).toBeUndefined();
  });

  it("getConfiguration fallback: get() returns defaultValue, has()=false, update() resolves", async () => {
    const cfg = bridge.getConfiguration("foo");
    expect(cfg.get("k", 42)).toBe(42);
    expect(cfg.has("k")).toBe(false);
    await expect(cfg.update("k", 1)).resolves.toBeUndefined();
  });

  it("getCanvasPages returns [] when no resolver", async () => {
    expect(await bridge.getCanvasPages()).toEqual([]);
  });

  it("getCanvasPageTree returns [] when no resolver", async () => {
    expect(await bridge.getCanvasPageTree()).toEqual([]);
  });

  it("all event properties are defined (fallback emitters)", () => {
    expect(typeof bridge.onDidChangeConfiguration).toBe("function");
    expect(typeof bridge.onDidChangeWorkspaceFolders).toBe("function");
    expect(typeof bridge.onDidChangeWorkspace).toBe("function");
    expect(typeof bridge.onDidRename).toBe("function");
    expect(typeof bridge.onDidFilesChange).toBe("function");
    expect(typeof bridge.onDidChangeCanvasPages).toBe("function");
  });

  it("dispose blocks subsequent method access with a tool-id-tagged error", () => {
    bridge.dispose();
    expect(() => bridge.workspaceFolders).toThrow(/Tool "t" has been deactivated/);
  });
});

describe("WorkspaceBridge — wired with workspaceService", () => {
  it("workspaceFolders returns serialized array; getWorkspaceFolder maps URI → folder", () => {
    const fooUri = URI.file("D:/x/foo");
    const ws = {
      folders: [{ uri: fooUri, name: "foo", index: 0 }],
      workspaceName: "MyWS",
      onDidChangeFolders: new Emitter<any>().event,
      onDidChangeWorkspace: new Emitter<any>().event,
      getWorkspaceFolder: (u: URI) =>
        u.toString() === fooUri.toString()
          ? { uri: fooUri, name: "foo", index: 0 }
          : undefined,
    };
    const bridge = new WorkspaceBridge("t", [], undefined, ws as any);
    expect(bridge.workspaceFolders).toEqual([
      { uri: fooUri.toString(), name: "foo", index: 0 },
    ]);
    expect(bridge.name).toBe("MyWS");
    expect(bridge.getWorkspaceFolder(fooUri.toString())).toEqual({
      uri: fooUri.toString(),
      name: "foo",
      index: 0,
    });
    expect(bridge.getWorkspaceFolder("file:///nope")).toBeUndefined();
  });

  it("onDidChangeWorkspaceFolders serializes added/removed via _serializeFolder", () => {
    const folderEmitter = new Emitter<any>();
    const ws = {
      folders: [],
      workspaceName: "n",
      onDidChangeFolders: folderEmitter.event,
      onDidChangeWorkspace: new Emitter<any>().event,
      getWorkspaceFolder: () => undefined,
    };
    const bridge = new WorkspaceBridge("t", [], undefined, ws as any);
    const captured: any[] = [];
    bridge.onDidChangeWorkspaceFolders((e) => captured.push(e));
    const u = URI.file("D:/a");
    folderEmitter.fire({
      added: [{ uri: u, name: "a", index: 0 }],
      removed: [],
    });
    expect(captured[0]).toEqual({
      added: [{ uri: u.toString(), name: "a", index: 0 }],
      removed: [],
    });
  });

  it("onDidChangeWorkspace maps internal payload to {id, name}; undefined passthrough", () => {
    const wsEmitter = new Emitter<any>();
    const ws = {
      folders: [],
      workspaceName: "n",
      onDidChangeFolders: new Emitter<any>().event,
      onDidChangeWorkspace: wsEmitter.event,
      getWorkspaceFolder: () => undefined,
    };
    const bridge = new WorkspaceBridge("t", [], undefined, ws as any);
    const captured: any[] = [];
    bridge.onDidChangeWorkspace((e) => captured.push(e));
    wsEmitter.fire({ id: "w1", name: "Hello", extraJunk: 1 });
    wsEmitter.fire(undefined);
    expect(captured).toEqual([{ id: "w1", name: "Hello" }, undefined]);
  });

  it("onDidRename forwards string payloads when service provides onDidRename", () => {
    const renameEmitter = new Emitter<string>();
    const ws = {
      folders: [],
      workspaceName: "n",
      onDidChangeFolders: new Emitter<any>().event,
      onDidChangeWorkspace: new Emitter<any>().event,
      onDidRename: renameEmitter.event,
      getWorkspaceFolder: () => undefined,
    };
    const bridge = new WorkspaceBridge("t", [], undefined, ws as any);
    const captured: string[] = [];
    bridge.onDidRename((n) => captured.push(n));
    renameEmitter.fire("NewName");
    expect(captured).toEqual(["NewName"]);
  });
});

describe("WorkspaceBridge — wired with configService", () => {
  it("onDidChangeConfiguration is the service's emitter event directly", () => {
    const cfgEmitter = new Emitter<any>();
    const cfg = {
      onDidChangeConfiguration: cfgEmitter.event,
      getConfiguration: () => ({ get: () => 1, update: async () => {}, has: () => true }),
    };
    const bridge = new WorkspaceBridge("t", [], cfg as any);
    expect(bridge.onDidChangeConfiguration).toBe(cfgEmitter.event);
    expect(bridge.getConfiguration().get("k")).toBe(1);
  });
});

describe("WorkspaceBridge — wired with fileService", () => {
  it("onDidFilesChange maps internal events → {type:number, uri:string}", () => {
    const fileEmitter = new Emitter<any>();
    const fs = { onDidFileChange: fileEmitter.event };
    const bridge = new WorkspaceBridge("t", [], undefined, undefined, fs as any);
    const captured: any[] = [];
    bridge.onDidFilesChange((e) => captured.push(e));
    const u = URI.file("D:/a/b.txt");
    fileEmitter.fire([{ type: 1, uri: u }, { type: 2, uri: u }]);
    expect(captured[0]).toEqual([
      { type: 1, uri: u.toString() },
      { type: 2, uri: u.toString() },
    ]);
  });
});

describe("WorkspaceBridge — canvas page resolver (M56)", () => {
  it("getCanvasPages filters archived and serializes via _serializePage", async () => {
    const pageEmitter = new Emitter<any>();
    const pages = [
      { id: "a", parentId: null, title: "A", icon: null, isFavorited: false, isArchived: false, createdAt: "t1", updatedAt: "t2" },
      { id: "b", parentId: null, title: "B", icon: null, isFavorited: false, isArchived: true,  createdAt: "t1", updatedAt: "t2" },
    ];
    const svc = {
      onDidChangePage: pageEmitter.event,
      getRootPages: async () => pages,
      getPageTree: async () => [{ ...pages[0], children: [] }],
    };
    const bridge = new WorkspaceBridge("t", [], undefined, undefined, undefined, () => svc as any);
    const out = await bridge.getCanvasPages();
    expect(out.map(p => p.id)).toEqual(["a"]); // 'b' (archived) filtered
    expect(out[0]).toMatchObject({ id: "a", title: "A", isArchived: false });
  });

  it("getCanvasPageTree serializes recursively (children preserved)", async () => {
    const child = { id: "c", parentId: "a", title: "C", icon: null, isFavorited: false, isArchived: false, createdAt: "x", updatedAt: "y", children: [] };
    const root = { id: "a", parentId: null, title: "A", icon: null, isFavorited: false, isArchived: false, createdAt: "x", updatedAt: "y", children: [child] };
    const svc = {
      onDidChangePage: new Emitter<any>().event,
      getRootPages: async () => [],
      getPageTree: async () => [root],
    };
    const bridge = new WorkspaceBridge("t", [], undefined, undefined, undefined, () => svc as any);
    const tree = await bridge.getCanvasPageTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("a");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("c");
  });

  it("onDidChangeCanvasPages forwards events serialized via _serializePage", async () => {
    const pageEmitter = new Emitter<any>();
    const svc = {
      onDidChangePage: pageEmitter.event,
      getRootPages: async () => [],
      getPageTree: async () => [],
    };
    const bridge = new WorkspaceBridge("t", [], undefined, undefined, undefined, () => svc as any);
    // Lazy subscription triggered on first call.
    await bridge.getCanvasPages();
    const captured: any[] = [];
    bridge.onDidChangeCanvasPages((e) => captured.push(e));
    const page = { id: "p", parentId: null, title: "P", icon: null, isFavorited: false, isArchived: false, createdAt: "x", updatedAt: "y" };
    pageEmitter.fire({ kind: "updated", pageId: "p", page });
    pageEmitter.fire({ kind: "deleted", pageId: "p" });
    expect(captured).toEqual([
      { kind: "updated", pageId: "p", page },
      { kind: "deleted", pageId: "p", page: undefined },
    ]);
  });
});
