import { describe, it, expect, vi } from "vitest";
import { EditorInput, PlaceholderEditorInput } from "../../src/editor/editorInput";
import type { SerializedEditorEntry } from "../../src/editor/editorTypes";

class TestInput extends EditorInput {
  readonly typeId = "test";
  constructor(public readonly name: string, public readonly description = "") {
    super();
  }
  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: false,
      sticky: false,
    };
  }
  // expose protected hooks for tests
  setDirtyPublic(d: boolean): void { (this as any).setDirty(d); }
  fireLabelChangePublic(): void { (this as any).fireLabelChange(); }
}

describe("EditorInput — identity", () => {
  it("auto-assigns a unique id when none is provided", () => {
    const a = new TestInput("a");
    const b = new TestInput("b");
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("uses the provided id when supplied", () => {
    class WithId extends TestInput {
      constructor() { super("x"); (this as any).id = "fixed"; }
    }
    // Cleaner approach: use the constructor id parameter on EditorInput.
    class Custom extends EditorInput {
      readonly typeId = "t";
      readonly name = "n";
      readonly description = "";
      constructor() { super("explicit-id"); }
      serialize(): SerializedEditorEntry { return { inputId: this.id, typeId: this.typeId, name: this.name, description: this.description, pinned: false, sticky: false }; }
    }
    const c = new Custom();
    expect(c.id).toBe("explicit-id");
    void WithId;
  });

  it("matches() compares inputs by id", () => {
    const a = new TestInput("a");
    const b = new TestInput("a"); // same name, different id
    expect(a.matches(a)).toBe(true);
    expect(a.matches(b)).toBe(false);
  });
});

describe("EditorInput — dirty state", () => {
  it("isDirty starts false and onDidChangeDirty fires only on changes", () => {
    const inp = new TestInput("a");
    const events: boolean[] = [];
    inp.onDidChangeDirty((v) => events.push(v));
    expect(inp.isDirty).toBe(false);
    inp.setDirtyPublic(false); // no-op, no event
    expect(events).toEqual([]);
    inp.setDirtyPublic(true);
    expect(inp.isDirty).toBe(true);
    expect(events).toEqual([true]);
    inp.setDirtyPublic(true); // no-op, no event
    expect(events).toEqual([true]);
    inp.setDirtyPublic(false);
    expect(events).toEqual([true, false]);
  });
});

describe("EditorInput — label change", () => {
  it("fireLabelChange dispatches onDidChangeLabel listeners", () => {
    const inp = new TestInput("a");
    const fn = vi.fn();
    inp.onDidChangeLabel(fn);
    inp.fireLabelChangePublic();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("EditorInput — dispose", () => {
  it("dispose() fires onWillDispose exactly once before underlying teardown", () => {
    const inp = new TestInput("a");
    const fn = vi.fn();
    inp.onWillDispose(fn);
    inp.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("EditorInput — close confirmation default", () => {
  it("confirmClose resolves true by default (no veto)", async () => {
    const inp = new TestInput("a");
    await expect(inp.confirmClose()).resolves.toBe(true);
  });
});

describe("PlaceholderEditorInput", () => {
  it("typeId is 'placeholder' and exposes the constructor name + description", () => {
    const p = new PlaceholderEditorInput("hello", "world");
    expect(p.typeId).toBe("placeholder");
    expect(p.name).toBe("hello");
    expect(p.description).toBe("world");
  });

  it("serialize() emits inputId/typeId/name/description with pinned and sticky false", () => {
    const p = new PlaceholderEditorInput("hello", "world", "explicit-id");
    expect(p.serialize()).toEqual({
      inputId: "explicit-id",
      typeId: "placeholder",
      name: "hello",
      description: "world",
      pinned: false,
      sticky: false,
    });
  });

  it("description defaults to empty string when omitted", () => {
    const p = new PlaceholderEditorInput("solo");
    expect(p.description).toBe("");
  });
});
