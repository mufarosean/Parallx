/**
 * Pin-the-invariant: small editor inputs (KeybindingsEditorInput singleton,
 * ReadonlyMarkdownInput basics).
 */
import { describe, it, expect, vi } from "vitest";
import { KeybindingsEditorInput } from "../../src/built-in/editor/keybindingsEditorInput";
import { ReadonlyMarkdownInput } from "../../src/built-in/editor/readonlyMarkdownInput";

describe("KeybindingsEditorInput", () => {
  it("typeId === parallx.editor.keybindings", () => {
    expect(KeybindingsEditorInput.getInstance().typeId).toBe("parallx.editor.keybindings");
  });

  it("name === 'Keyboard Shortcuts' and not dirty", () => {
    const a = KeybindingsEditorInput.getInstance();
    expect(a.name).toBe("Keyboard Shortcuts");
    expect(a.isDirty).toBe(false);
    expect(a.description).toBe("");
  });

  it("getInstance() returns same singleton across calls", () => {
    const a = KeybindingsEditorInput.getInstance();
    const b = KeybindingsEditorInput.getInstance();
    expect(a).toBe(b);
  });

  it("getInstance() recreates after dispose()", () => {
    const a = KeybindingsEditorInput.getInstance();
    a.dispose();
    const b = KeybindingsEditorInput.getInstance();
    expect(b).not.toBe(a);
  });

  it("matches() is true for any other KeybindingsEditorInput", () => {
    const a = KeybindingsEditorInput.getInstance();
    expect(a.matches(a)).toBe(true);
  });

  it("matches() is false for unrelated inputs", () => {
    const a = KeybindingsEditorInput.getInstance();
    const other: any = { id: "x", typeId: "y" };
    expect(a.matches(other)).toBe(false);
  });

  it("serialize() emits non-pinned, non-sticky entry", () => {
    const s = KeybindingsEditorInput.getInstance().serialize();
    expect(s.typeId).toBe("parallx.editor.keybindings");
    expect(s.name).toBe("Keyboard Shortcuts");
    expect(s.pinned).toBe(false);
    expect(s.sticky).toBe(false);
  });
});

describe("ReadonlyMarkdownInput", () => {
  it("typeId === parallx.editor.readonlyMarkdown", () => {
    expect(ReadonlyMarkdownInput.create("body", "n").typeId).toBe("parallx.editor.readonlyMarkdown");
  });

  it("create() retains content + name and is never dirty", () => {
    const a = ReadonlyMarkdownInput.create("body", "Title");
    expect(a.content).toBe("body");
    expect(a.name).toBe("Title");
    expect(a.isDirty).toBe(false);
  });

  it("URI scheme = parallx-readonly-md", () => {
    const a = ReadonlyMarkdownInput.create("x", "Title");
    expect(a.uri.toString()).toMatch(/^parallx-readonly-md:/);
  });

  it("updateContent fires onDidChangeContent only on actual change", () => {
    const a = ReadonlyMarkdownInput.create("a", "n");
    const spy = vi.fn();
    a.onDidChangeContent(spy);
    a.updateContent("a");
    a.updateContent("b");
    a.updateContent("b");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("b");
  });

  it("save() returns undefined and revert()/confirmClose() are no-op truthy", async () => {
    const a = ReadonlyMarkdownInput.create("x", "n");
    expect(await a.save()).toBeUndefined();
    await expect(a.revert()).resolves.toBeUndefined();
    expect(await a.confirmClose()).toBe(true);
  });

  it("serialize() carries name + content + pinned=false", () => {
    const a = ReadonlyMarkdownInput.create("body", "Title");
    const s = a.serialize();
    expect(s.name).toBe("Title");
    expect(s.pinned).toBe(false);
    expect(s.sticky).toBe(false);
    expect(s.data).toEqual({ content: "body" });
  });
});
