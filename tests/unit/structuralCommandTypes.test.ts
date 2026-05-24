/**
 * Pin-the-invariant: commands/structuralCommandTypes.ts pure helpers.
 *   - wb() simply casts ctx.workbench to WorkbenchLike (no side effects).
 *   - electronBridge() returns globalThis.parallxElectron (or undefined).
 *   - ensureUriWithinWorkspaceOrPrompt() short-circuits true when the URI is
 *     already inside a workspace folder, prompts via IFileService.showMessageBox
 *     when not, adds the folder + saves on confirm, and bails out on cancel
 *     or on a missing parent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  wb,
  electronBridge,
  ensureUriWithinWorkspaceOrPrompt,
} from "../../src/commands/structuralCommandTypes";
import { URI } from "../../src/platform/uri";

beforeEach(() => {
  delete (globalThis as any).parallxElectron;
});

afterEach(() => {
  delete (globalThis as any).parallxElectron;
});

describe("wb()", () => {
  it("returns ctx.workbench by reference (no copy)", () => {
    const bench = { sentinel: 1 };
    const out = wb({ workbench: bench, getService: () => undefined } as any);
    expect(out).toBe(bench as any);
  });
});

describe("electronBridge()", () => {
  it("returns undefined when no bridge is exposed", () => {
    expect(electronBridge()).toBeUndefined();
  });
  it("returns the bridge object when present on globalThis", () => {
    const bridge = { close: vi.fn() } as any;
    (globalThis as any).parallxElectron = bridge;
    expect(electronBridge()).toBe(bridge);
  });
});

function makeCtx(opts: {
  getWorkspaceFolder: (uri: URI) => unknown;
  addFolder?: (uri: URI) => void;
  save?: () => Promise<void>;
  showMessageBox?: (...args: any[]) => any;
  fileService?: any;
}) {
  const wsService = {
    getWorkspaceFolder: opts.getWorkspaceFolder,
    addFolder: opts.addFolder ?? vi.fn(),
  };
  const workbench = {
    _workspaceSaver: { save: opts.save ?? vi.fn().mockResolvedValue(undefined) },
  };
  return {
    workbench,
    getService: (id: string) => {
      if (id === "IWorkspaceService") return wsService;
      if (id === "IFileService") return opts.fileService;
      return undefined;
    },
    wsService,
    workbench_: workbench,
  };
}

describe("ensureUriWithinWorkspaceOrPrompt", () => {
  it("returns true (no prompt) when no workspace service is registered", async () => {
    const r = await ensureUriWithinWorkspaceOrPrompt(
      { workbench: {}, getService: () => undefined } as any,
      URI.parse("file:///x/y.txt"),
      "Create File",
    );
    expect(r).toBe(true);
  });

  it("returns true when the URI is already inside a workspace folder", async () => {
    const ctx = makeCtx({ getWorkspaceFolder: () => ({ uri: "ws" }) });
    const r = await ensureUriWithinWorkspaceOrPrompt(
      ctx as any,
      URI.parse("file:///inside/y.txt"),
      "Create File",
    );
    expect(r).toBe(true);
  });

  it("returns false when the URI has no parent (root-level) and is outside the workspace", async () => {
    const ctx = makeCtx({ getWorkspaceFolder: () => undefined });
    // URI.dirname returns null for roots; force this by stubbing
    const uri = URI.parse("file:///x.txt");
    Object.defineProperty(uri, "dirname", { value: null, configurable: true });
    const r = await ensureUriWithinWorkspaceOrPrompt(
      ctx as any,
      uri,
      "Create File",
    );
    expect(r).toBe(false);
  });

  it("prompts via IFileService.showMessageBox and bails on cancel (response !== 0)", async () => {
    const showMessageBox = vi
      .fn()
      .mockResolvedValue({ response: 1, checkboxChecked: false });
    const fileService = { showMessageBox };
    const addFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      getWorkspaceFolder: () => undefined,
      fileService,
      addFolder,
      save,
    });
    const r = await ensureUriWithinWorkspaceOrPrompt(
      ctx as any,
      URI.parse("file:///outside/y.txt"),
      "Create File",
    );
    expect(r).toBe(false);
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(addFolder).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("adds parent folder + saves workspace + returns true on confirm (response === 0)", async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
    const fileService = { showMessageBox };
    const addFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      getWorkspaceFolder: () => undefined,
      fileService,
      addFolder,
      save,
    });
    const uri = URI.parse("file:///outside/y.txt");
    const r = await ensureUriWithinWorkspaceOrPrompt(
      ctx as any,
      uri,
      "Create File",
    );
    expect(r).toBe(true);
    expect(addFolder).toHaveBeenCalledWith(uri.dirname);
    expect(save).toHaveBeenCalledOnce();
  });

  it("bails (response defaults to 1) when no IFileService is available", async () => {
    const addFolder = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      getWorkspaceFolder: () => undefined,
      fileService: undefined,
      addFolder,
      save,
    });
    const r = await ensureUriWithinWorkspaceOrPrompt(
      ctx as any,
      URI.parse("file:///outside/y.txt"),
      "Create File",
    );
    expect(r).toBe(false);
    expect(addFolder).not.toHaveBeenCalled();
  });
});
