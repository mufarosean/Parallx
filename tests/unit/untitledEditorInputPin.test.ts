/**
 * Pin-the-invariant: UntitledEditorInput — counter, dirty semantics, factory variants, save/revert/confirmClose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UntitledEditorInput } from "../../src/built-in/editor/untitledEditorInput";

describe("UntitledEditorInput", () => {
  beforeEach(() => {
    delete (globalThis as any).parallxElectron;
  });
  afterEach(() => {
    delete (globalThis as any).parallxElectron;
  });

  it("create() produces Untitled-N with increasing counter", () => {
    const a = UntitledEditorInput.create();
    const b = UntitledEditorInput.create();
    expect(a.name).toMatch(/^Untitled-\d+$/);
    expect(b.name).toMatch(/^Untitled-\d+$/);
    expect(a.name).not.toBe(b.name);
  });

  it("create() is not dirty and content is empty", () => {
    const a = UntitledEditorInput.create();
    expect(a.isDirty).toBe(false);
    expect(a.content).toBe("");
  });

  it("typeId === parallx.editor.untitled", () => {
    expect(UntitledEditorInput.create().typeId).toBe("parallx.editor.untitled");
  });

  it("URI scheme = untitled with id-based authority", () => {
    const a = UntitledEditorInput.create();
    expect(a.uri.toString()).toMatch(/^untitled:/);
  });

  it("createWithContent(non-empty) is dirty", () => {
    const a = UntitledEditorInput.createWithContent("hello");
    expect(a.content).toBe("hello");
    expect(a.isDirty).toBe(true);
  });

  it("createWithContent('') is NOT dirty", () => {
    const a = UntitledEditorInput.createWithContent("");
    expect(a.isDirty).toBe(false);
  });

  it("createReadonly(content, name) sets custom name and is NOT dirty", () => {
    const a = UntitledEditorInput.createReadonly("data", "Session Memory");
    expect(a.name).toBe("Session Memory");
    expect(a.isDirty).toBe(false);
  });

  it("updateContent('') from dirty state clears dirty", () => {
    const a = UntitledEditorInput.createWithContent("xxx");
    expect(a.isDirty).toBe(true);
    a.updateContent("");
    expect(a.isDirty).toBe(false);
  });

  it("updateContent fires onDidChangeContent only when content changes", () => {
    const a = UntitledEditorInput.create();
    const spy = vi.fn();
    a.onDidChangeContent(spy);
    a.updateContent("abc");
    a.updateContent("abc");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("abc");
  });

  it("save() returns undefined when no electron bridge", async () => {
    const a = UntitledEditorInput.createWithContent("x");
    expect(await a.save()).toBeUndefined();
  });

  it("save() returns undefined when user cancels saveFile dialog", async () => {
    (globalThis as any).parallxElectron = {
      dialog: { saveFile: vi.fn().mockResolvedValue(null) },
    };
    const a = UntitledEditorInput.createWithContent("x");
    expect(await a.save()).toBeUndefined();
  });

  it("save() writes file via parallxElectron.fs.writeFile and returns target URI", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).parallxElectron = {
      dialog: { saveFile: vi.fn().mockResolvedValue("/tmp/out.txt") },
      fs: { writeFile },
    };
    const a = UntitledEditorInput.createWithContent("body");
    const uri = await a.save();
    expect(uri).toBeDefined();
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("out.txt"), "body");
  });

  it("revert() clears content and dirty state and fires content event", async () => {
    const a = UntitledEditorInput.createWithContent("data");
    const spy = vi.fn();
    a.onDidChangeContent(spy);
    await a.revert();
    expect(a.content).toBe("");
    expect(a.isDirty).toBe(false);
    expect(spy).toHaveBeenCalledWith("");
  });

  it("confirmClose() returns true for non-dirty (empty) untitled", async () => {
    const a = UntitledEditorInput.create();
    expect(await a.confirmClose()).toBe(true);
  });

  it("confirmClose() handles Save (response=0) by saving + true on success", async () => {
    (globalThis as any).parallxElectron = {
      dialog: {
        showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
        saveFile: vi.fn().mockResolvedValue("/tmp/x.txt"),
      },
      fs: { writeFile: vi.fn().mockResolvedValue(undefined) },
    };
    const a = UntitledEditorInput.createWithContent("d");
    expect(await a.confirmClose()).toBe(true);
  });

  it("confirmClose() returns true for Don't Save (response=1)", async () => {
    (globalThis as any).parallxElectron = {
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    };
    const a = UntitledEditorInput.createWithContent("d");
    expect(await a.confirmClose()).toBe(true);
  });

  it("confirmClose() returns false for Cancel (response=2)", async () => {
    (globalThis as any).parallxElectron = {
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 2 }) },
    };
    const a = UntitledEditorInput.createWithContent("d");
    expect(await a.confirmClose()).toBe(false);
  });

  it("serialize() round-trip includes typeId/pinned/content", () => {
    const a = UntitledEditorInput.createWithContent("body");
    const s = a.serialize();
    expect(s.typeId).toBe("parallx.editor.untitled");
    expect(s.pinned).toBe(true);
    expect(s.sticky).toBe(false);
    expect(s.data).toEqual({ content: "body" });
  });
});
