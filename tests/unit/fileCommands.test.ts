/**
 * Pin-the-invariant: commands/fileCommands.ts keybindings + service guards.
 * Keep dynamic-import branches out — those touch DOM-bound editor inputs.
 */
import { describe, it, expect, vi } from "vitest";
import {
  fileOpenFile,
  fileNewTextFile,
  fileSave,
  fileSaveAs,
  fileRevert,
  fileSaveAll,
} from "../../src/commands/fileCommands";

function ctx(services: Record<string, any> = {}) {
  return {
    workbench: {},
    getService: (id: string) => services[id],
  } as any;
}

describe("fileCommands — keybindings", () => {
  it("fileOpenFile Ctrl+O", () => expect(fileOpenFile.keybinding).toBe("Ctrl+O"));
  it("fileNewTextFile Ctrl+N", () => expect(fileNewTextFile.keybinding).toBe("Ctrl+N"));
  it("fileSave Ctrl+S + when=activeEditor", () => {
    expect(fileSave.keybinding).toBe("Ctrl+S");
    expect(fileSave.when).toBe("activeEditor");
  });
  it("fileSaveAs Ctrl+Shift+S", () => expect(fileSaveAs.keybinding).toBe("Ctrl+Shift+S"));
  it("fileSaveAll Ctrl+K S", () => expect(fileSaveAll.keybinding).toBe("Ctrl+K S"));
});

describe("fileOpenFile — no bridge / no editor service", () => {
  it("no-op without Electron bridge", async () => {
    delete (globalThis as any).parallxElectron;
    const openEditor = vi.fn();
    await fileOpenFile.handler!(ctx({ IEditorService: { openEditor } }));
    expect(openEditor).not.toHaveBeenCalled();
  });
});

describe("fileNewTextFile", () => {
  it("no-op without IEditorService", async () => {
    await expect(fileNewTextFile.handler!(ctx())).resolves.toBeUndefined();
  });
});

describe("fileSave guards", () => {
  it("no-op when activeEditor is missing", async () => {
    await fileSave.handler!(ctx({ IEditorService: {} }));
  });

  it("delegates to activeEditor.save() when available", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    await fileSave.handler!(ctx({ IEditorService: { activeEditor: { save } } }));
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("fileSaveAs guards", () => {
  it("no-op when activeEditor is missing", async () => {
    await fileSaveAs.handler!(ctx({ IEditorService: {} }));
  });
  it("no-op without bridge even when an active editor exists", async () => {
    delete (globalThis as any).parallxElectron;
    const writeFile = vi.fn();
    await fileSaveAs.handler!(
      ctx({
        IEditorService: { activeEditor: {} },
        IFileService: { writeFile },
      }),
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("fileRevert guards", () => {
  it("no-op when activeEditor is missing", async () => {
    await fileRevert.handler!(ctx({ IEditorService: {} }));
  });

  it("no-op when active editor has no uri (untitled)", async () => {
    const revert = vi.fn();
    await fileRevert.handler!(
      ctx({ IEditorService: { activeEditor: { revert } } }),
    );
    expect(revert).not.toHaveBeenCalled();
  });

  it("delegates to activeEditor.revert() when uri is a real file", async () => {
    const { URI } = await import("../../src/platform/uri");
    const revert = vi.fn().mockResolvedValue(undefined);
    await fileRevert.handler!(
      ctx({
        IEditorService: {
          activeEditor: { uri: URI.file("/x"), revert, isDirty: false },
        },
      }),
    );
    expect(revert).toHaveBeenCalledOnce();
  });
});

describe("fileSaveAll", () => {
  it("delegates to ITextFileModelManager.saveAll()", async () => {
    const saveAll = vi.fn().mockResolvedValue(undefined);
    await fileSaveAll.handler!(ctx({ ITextFileModelManager: { saveAll } }));
    expect(saveAll).toHaveBeenCalledOnce();
  });
  it("is a no-op when model manager is absent", async () => {
    await expect(fileSaveAll.handler!(ctx())).resolves.toBeUndefined();
  });
});
