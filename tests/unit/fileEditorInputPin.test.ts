/**
 * Pin-the-invariant: FileEditorInput — identity (toKey-based id, matches), dirty proxy,
 * resolve/save/saveAs/revert/confirmClose/serialize/dispose. Stubs TextFileModel + FileService.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileEditorInput } from "../../src/built-in/editor/fileEditorInput";
import { URI } from "../../src/platform/uri";
import { Emitter } from "../../src/platform/events";

function makeModel(content = "abc", isDirty = false) {
  const dirtyEmitter = new Emitter<boolean>();
  const contentEmitter = new Emitter<void>();
  const model: any = {
    content,
    isDirty,
    isDisposed: false,
    onDidChangeDirty: dirtyEmitter.event,
    onDidChangeContent: contentEmitter.event,
    save: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    updateContent: vi.fn((s: string) => {
      model.content = s;
      contentEmitter.fire();
    }),
    _emitDirty: (v: boolean) => {
      model.isDirty = v;
      dirtyEmitter.fire(v);
    },
  };
  return model;
}

function makeManager(model: any) {
  return { resolve: vi.fn().mockResolvedValue(model) };
}
function makeFileService() {
  return { writeFile: vi.fn().mockResolvedValue(undefined) };
}

describe("FileEditorInput", () => {
  beforeEach(() => {
    delete (globalThis as any).parallxElectron;
  });
  afterEach(() => {
    delete (globalThis as any).parallxElectron;
  });

  it("typeId === parallx.editor.file", () => {
    const uri = URI.file("/tmp/a.txt");
    const input = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any);
    expect(input.typeId).toBe("parallx.editor.file");
  });

  it("name comes from URI basename", () => {
    const uri = URI.file("/tmp/sub/hello.md");
    const input = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any);
    expect(input.name).toBe("hello.md");
  });

  it("description prefers explicit relativePath else fsPath", () => {
    const uri = URI.file("/tmp/x.txt");
    const withRel = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any, "rel/x.txt");
    expect(withRel.description).toBe("rel/x.txt");
    const noRel = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any);
    expect(noRel.description).toBe(uri.fsPath);
  });

  it("isDirty/content default to false/empty before resolve()", () => {
    const uri = URI.file("/tmp/a.txt");
    const input = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any);
    expect(input.isDirty).toBe(false);
    expect(input.content).toBe("");
  });

  it("resolve() returns model and syncs initial dirty state", async () => {
    const uri = URI.file("/tmp/a.txt");
    const model = makeModel("body", true);
    const input = FileEditorInput.create(uri, makeManager(model) as any, makeFileService() as any);
    const m = await input.resolve();
    expect(m).toBe(model);
    expect(input.content).toBe("body");
    expect(input.isDirty).toBe(true);
  });

  it("resolve() forwards model dirty changes to input", async () => {
    const uri = URI.file("/tmp/a.txt");
    const model = makeModel("body", false);
    const input = FileEditorInput.create(uri, makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    model._emitDirty(true);
    expect(input.isDirty).toBe(true);
    model._emitDirty(false);
    expect(input.isDirty).toBe(false);
  });

  it("resolve() forwards model content changes via onDidChangeContent", async () => {
    const uri = URI.file("/tmp/a.txt");
    const model = makeModel("body", false);
    const input = FileEditorInput.create(uri, makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    const spy = vi.fn();
    input.onDidChangeContent(spy);
    model.updateContent("new");
    expect(spy).toHaveBeenCalledWith("new");
  });

  it("save() delegates to model.save", async () => {
    const model = makeModel();
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    await input.save();
    expect(model.save).toHaveBeenCalled();
  });

  it("save() no-ops when not resolved", async () => {
    const model = makeModel();
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.save();
    expect(model.save).not.toHaveBeenCalled();
  });

  it("revert() delegates to model.revert", async () => {
    const model = makeModel();
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    await input.revert();
    expect(model.revert).toHaveBeenCalled();
  });

  it("saveAs() writes content to target URI and re-resolves model", async () => {
    const original = makeModel("payload");
    const renamed = makeModel("payload");
    const manager = { resolve: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(renamed) };
    const fileSvc = makeFileService();
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), manager as any, fileSvc as any);
    await input.resolve();
    const target = URI.file("/tmp/b.txt");
    const out = await input.saveAs(target);
    expect(out).toBe(input);
    expect(fileSvc.writeFile).toHaveBeenCalledWith(target, "payload");
    expect(original.release).toHaveBeenCalled();
    expect(input.uri.equals(target)).toBe(true);
  });

  it("matches() compares by URI for two FileEditorInputs", () => {
    const uri = URI.file("/tmp/a.txt");
    const a = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any);
    const b = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(makeModel()) as any, makeFileService() as any);
    const c = FileEditorInput.create(URI.file("/tmp/c.txt"), makeManager(makeModel()) as any, makeFileService() as any);
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
  });

  it("confirmClose() returns true when not dirty", async () => {
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(makeModel()) as any, makeFileService() as any);
    expect(await input.confirmClose()).toBe(true);
  });

  it("confirmClose() Save (0) saves and returns true", async () => {
    const model = makeModel("x", true);
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    (globalThis as any).parallxElectron = {
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
    };
    expect(await input.confirmClose()).toBe(true);
    expect(model.save).toHaveBeenCalled();
  });

  it("confirmClose() Don't Save (1) returns true without save", async () => {
    const model = makeModel("x", true);
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    (globalThis as any).parallxElectron = {
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    };
    expect(await input.confirmClose()).toBe(true);
    expect(model.save).not.toHaveBeenCalled();
  });

  it("confirmClose() Cancel (2) returns false", async () => {
    const model = makeModel("x", true);
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    (globalThis as any).parallxElectron = {
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 2 }) },
    };
    expect(await input.confirmClose()).toBe(false);
  });

  it("serialize() emits typeId/name/description/uri", () => {
    const uri = URI.file("/tmp/a.txt");
    const input = FileEditorInput.create(uri, makeManager(makeModel()) as any, makeFileService() as any, "rel/a.txt");
    const s = input.serialize();
    expect(s.typeId).toBe("parallx.editor.file");
    expect(s.name).toBe("a.txt");
    expect(s.description).toBe("rel/a.txt");
    expect(s.pinned).toBe(true);
    expect(s.data).toEqual({ uri: uri.toString() });
  });

  it("dispose() releases the model", async () => {
    const model = makeModel();
    const input = FileEditorInput.create(URI.file("/tmp/a.txt"), makeManager(model) as any, makeFileService() as any);
    await input.resolve();
    input.dispose();
    expect(model.release).toHaveBeenCalled();
  });
});
