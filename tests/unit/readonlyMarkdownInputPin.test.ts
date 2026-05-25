/**
 * Pin: ReadonlyMarkdownInput — in-memory readonly markdown EditorInput
 * used by the session-memory viewer.  Covers TYPE_ID, factory + counter
 * id allocation, URI scheme, immutable fields, isDirty=false invariant,
 * updateContent equality short-circuit + emitter fire, save/revert
 * no-ops, confirmClose true, and serialize() shape.
 */
import { describe, it, expect, vi } from "vitest";
import { ReadonlyMarkdownInput } from "../../src/built-in/editor/readonlyMarkdownInput";

describe("ReadonlyMarkdownInput — static surface", () => {
  it("TYPE_ID is 'parallx.editor.readonlyMarkdown'", () => {
    expect(ReadonlyMarkdownInput.TYPE_ID).toBe("parallx.editor.readonlyMarkdown");
  });

  it("create() is the only public factory and returns an instance", () => {
    const input = ReadonlyMarkdownInput.create("hello", "Notes");
    expect(input).toBeInstanceOf(ReadonlyMarkdownInput);
  });
});

describe("ReadonlyMarkdownInput — identity and shape", () => {
  it("typeId / name / description / content / isDirty match constructor inputs", () => {
    const input = ReadonlyMarkdownInput.create("# Hi", "My Doc");
    expect(input.typeId).toBe(ReadonlyMarkdownInput.TYPE_ID);
    expect(input.name).toBe("My Doc");
    expect(input.description).toBe("");
    expect(input.content).toBe("# Hi");
    expect(input.isDirty).toBe(false);
  });

  it("assigns sequential ids and a parallx-readonly-md:// URI per instance", () => {
    const a = ReadonlyMarkdownInput.create("a", "A");
    const b = ReadonlyMarkdownInput.create("b", "B");
    expect(a.id).toMatch(/^readonly-md-\d+$/);
    expect(b.id).toMatch(/^readonly-md-\d+$/);
    expect(a.id).not.toBe(b.id);
    expect(a.uri.toString()).toBe(`parallx-readonly-md://${a.id}`);
    expect(b.uri.toString()).toBe(`parallx-readonly-md://${b.id}`);
  });

  it("matches() uses base-class id equality", () => {
    const a = ReadonlyMarkdownInput.create("x", "A");
    const b = ReadonlyMarkdownInput.create("x", "A");
    expect(a.matches(a)).toBe(true);
    expect(a.matches(b)).toBe(false);
  });
});

describe("ReadonlyMarkdownInput — updateContent", () => {
  it("no-ops + does not fire when content is unchanged", () => {
    const input = ReadonlyMarkdownInput.create("same", "N");
    const cb = vi.fn();
    input.onDidChangeContent(cb);
    input.updateContent("same");
    expect(cb).not.toHaveBeenCalled();
    expect(input.content).toBe("same");
  });

  it("updates content and fires onDidChangeContent with new value when changed", () => {
    const input = ReadonlyMarkdownInput.create("a", "N");
    const cb = vi.fn();
    input.onDidChangeContent(cb);
    input.updateContent("b");
    expect(input.content).toBe("b");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("b");
  });

  it("isDirty stays false across content updates", () => {
    const input = ReadonlyMarkdownInput.create("a", "N");
    input.updateContent("b");
    input.updateContent("c");
    expect(input.isDirty).toBe(false);
  });
});

describe("ReadonlyMarkdownInput — lifecycle no-ops", () => {
  it("save() resolves to undefined", async () => {
    expect(await ReadonlyMarkdownInput.create("x", "N").save()).toBeUndefined();
  });

  it("revert() resolves to undefined", async () => {
    expect(await ReadonlyMarkdownInput.create("x", "N").revert()).toBeUndefined();
  });

  it("confirmClose() always resolves true", async () => {
    expect(await ReadonlyMarkdownInput.create("x", "N").confirmClose()).toBe(true);
  });
});

describe("ReadonlyMarkdownInput — serialize()", () => {
  it("returns SerializedEditorEntry shape with current content snapshot", () => {
    const input = ReadonlyMarkdownInput.create("BODY", "Title");
    const s = input.serialize();
    expect(s).toEqual({
      inputId: input.id,
      typeId: ReadonlyMarkdownInput.TYPE_ID,
      name: "Title",
      pinned: false,
      sticky: false,
      data: { content: "BODY" },
    });
  });

  it("reflects post-updateContent content in subsequent serialize() calls", () => {
    const input = ReadonlyMarkdownInput.create("v1", "T");
    expect(input.serialize().data).toEqual({ content: "v1" });
    input.updateContent("v2");
    expect(input.serialize().data).toEqual({ content: "v2" });
  });
});
