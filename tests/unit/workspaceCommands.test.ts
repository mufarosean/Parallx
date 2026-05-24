/**
 * Pin-the-invariant: commands/workspaceCommands.ts — keybindings + ctx-shape
 * contracts for the non-DOM-bound workspace command handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  workspaceSave,
  workspaceSwitch,
  workspaceDuplicate,
  workspaceAddFolder,
  workspaceRemoveFolder,
  workspaceCloseFolder,
  workspaceCloseWindow,
  workspaceOpenRecent,
  workspaceOpenFolder,
} from "../../src/commands/workspaceCommands";
import { URI } from "../../src/platform/uri";

beforeEach(() => {
  delete (globalThis as any).parallxElectron;
});
afterEach(() => {
  delete (globalThis as any).parallxElectron;
});

function makeCtx(opts: {
  workbench?: any;
  workspaceService?: any;
  fileService?: any;
} = {}) {
  return {
    workbench: opts.workbench ?? {},
    getService: (id: string) => {
      if (id === "IWorkspaceService") return opts.workspaceService;
      if (id === "IFileService") return opts.fileService;
      return undefined;
    },
  } as any;
}

describe("workspaceSave", () => {
  it("invokes _workspaceSaver.save() on the active workbench", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    await workspaceSave.handler!(
      makeCtx({ workbench: { _workspaceSaver: { save } } }),
    );
    expect(save).toHaveBeenCalledOnce();
  });
  it("Ctrl+S keybinding", () => {
    expect(workspaceSave.keybinding).toBe("Ctrl+S");
  });
});

describe("workspaceSwitch", () => {
  it("requires a string argument; warns and bails out otherwise", async () => {
    const switchWorkspace = vi.fn();
    await workspaceSwitch.handler!(makeCtx({ workbench: { switchWorkspace } }), 42);
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("invokes workbench.switchWorkspace(targetId)", async () => {
    const switchWorkspace = vi.fn().mockResolvedValue(undefined);
    await workspaceSwitch.handler!(
      makeCtx({ workbench: { switchWorkspace } }),
      "ws-7",
    );
    expect(switchWorkspace).toHaveBeenCalledWith("ws-7");
  });
});

describe("workspaceDuplicate", () => {
  it("saves, collects state, then createWorkspace with switchTo=false + clonedState", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const collectState = vi.fn(() => ({ snap: 1 }));
    const createWorkspace = vi.fn().mockResolvedValue({ id: "ws-new" });
    const wb = {
      _workspaceSaver: { save, collectState },
      workspace: { name: "Mine" },
      createWorkspace,
    };
    await workspaceDuplicate.handler!(makeCtx({ workbench: wb }));
    expect(save).toHaveBeenCalledOnce();
    expect(collectState).toHaveBeenCalledOnce();
    expect(createWorkspace).toHaveBeenCalledWith(
      "Mine (Copy)",
      undefined,
      false,
      { snap: 1 },
    );
  });
});

describe("workspaceAddFolder", () => {
  it("is a no-op when Electron bridge is unavailable", async () => {
    const openFolder = vi.fn();
    await workspaceAddFolder.handler!(makeCtx({ workbench: { openFolder } }));
    expect(openFolder).not.toHaveBeenCalled();
  });

  it("opens dialog, bails on cancel (empty result)", async () => {
    const dialog = { openFolder: vi.fn().mockResolvedValue([]) };
    (globalThis as any).parallxElectron = { dialog };
    const openFolder = vi.fn();
    await workspaceAddFolder.handler!(makeCtx({ workbench: { openFolder } }));
    expect(openFolder).not.toHaveBeenCalled();
  });

  it("on confirmed dialog path: invokes workbench.openFolder(path)", async () => {
    const dialog = { openFolder: vi.fn().mockResolvedValue(["/p"]) };
    (globalThis as any).parallxElectron = { dialog };
    const openFolder = vi.fn().mockResolvedValue(undefined);
    await workspaceAddFolder.handler!(makeCtx({ workbench: { openFolder } }));
    expect(openFolder).toHaveBeenCalledWith("/p");
  });
});

describe("workspaceRemoveFolder", () => {
  it("bails when IWorkspaceService is missing", async () => {
    const save = vi.fn();
    await workspaceRemoveFolder.handler!(
      makeCtx({ workbench: { _workspaceSaver: { save } } }),
      "/x",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("removes the only folder when one exists", async () => {
    const f0 = { uri: URI.file("/a"), name: "a" };
    const removeFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ws = { folders: [f0], removeFolder };
    await workspaceRemoveFolder.handler!(
      makeCtx({
        workbench: { _workspaceSaver: { save } },
        workspaceService: ws,
      }),
    );
    expect(removeFolder).toHaveBeenCalledWith(f0.uri);
    expect(save).toHaveBeenCalledOnce();
  });

  it("when given an explicit folder path string, removes URI.file(path)", async () => {
    const removeFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ws = {
      folders: [{ uri: URI.file("/a"), name: "a" }, { uri: URI.file("/b"), name: "b" }],
      removeFolder,
    };
    await workspaceRemoveFolder.handler!(
      makeCtx({
        workbench: { _workspaceSaver: { save } },
        workspaceService: ws,
      }),
      "/b",
    );
    const callArg = removeFolder.mock.calls[0][0] as URI;
    expect(callArg.fsPath.endsWith("b")).toBe(true);
  });

  it("with multiple folders and no arg, falls back to removing the last folder", async () => {
    const removeFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ws = {
      folders: [{ uri: URI.file("/a"), name: "a" }, { uri: URI.file("/b"), name: "b" }],
      removeFolder,
    };
    await workspaceRemoveFolder.handler!(
      makeCtx({
        workbench: { _workspaceSaver: { save } },
        workspaceService: ws,
      }),
    );
    expect(removeFolder).toHaveBeenCalledWith(ws.folders[1].uri);
  });

  it("no folders: no save, no removeFolder", async () => {
    const removeFolder = vi.fn();
    const save = vi.fn();
    await workspaceRemoveFolder.handler!(
      makeCtx({
        workbench: { _workspaceSaver: { save } },
        workspaceService: { folders: [], removeFolder },
      }),
    );
    expect(removeFolder).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("workspaceCloseFolder", () => {
  it("Ctrl+K Ctrl+F keybinding", () => {
    expect(workspaceCloseFolder.keybinding).toBe("Ctrl+K Ctrl+F");
  });
  it("removes every folder + saves", async () => {
    const removeFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ws = {
      folders: [
        { uri: URI.file("/a"), name: "a" },
        { uri: URI.file("/b"), name: "b" },
      ],
      removeFolder,
    };
    await workspaceCloseFolder.handler!(
      makeCtx({
        workbench: { _workspaceSaver: { save } },
        workspaceService: ws,
      }),
    );
    expect(removeFolder).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("workspaceCloseWindow", () => {
  it("Alt+F4 keybinding", () => {
    expect(workspaceCloseWindow.keybinding).toBe("Alt+F4");
  });

  it("saves, then calls bridge.close() when bridge is present", async () => {
    const close = vi.fn();
    (globalThis as any).parallxElectron = { close, dialog: {} };
    const save = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn();
    await workspaceCloseWindow.handler!(
      makeCtx({ workbench: { _workspaceSaver: { save }, shutdown } }),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("saves, then falls back to workbench.shutdown() when no bridge", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await workspaceCloseWindow.handler!(
      makeCtx({ workbench: { _workspaceSaver: { save }, shutdown } }),
    );
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

describe("workspaceOpenRecent / workspaceOpenFolder", () => {
  it("workspaceOpenRecent shows quick-open in general mode", async () => {
    const showQuickOpen = vi.fn();
    await workspaceOpenRecent.handler!(makeCtx({ workbench: { showQuickOpen } }));
    expect(showQuickOpen).toHaveBeenCalledOnce();
  });

  it("workspaceOpenFolder is a no-op without bridge", async () => {
    const openFolder = vi.fn();
    await workspaceOpenFolder.handler!(makeCtx({ workbench: { openFolder } }));
    expect(openFolder).not.toHaveBeenCalled();
  });

  it("workspaceOpenFolder delegates to workbench.openFolder(path) on confirm", async () => {
    (globalThis as any).parallxElectron = {
      dialog: { openFolder: vi.fn().mockResolvedValue(["/x"]) },
    };
    const openFolder = vi.fn().mockResolvedValue(undefined);
    await workspaceOpenFolder.handler!(makeCtx({ workbench: { openFolder } }));
    expect(openFolder).toHaveBeenCalledWith("/x");
  });
});
