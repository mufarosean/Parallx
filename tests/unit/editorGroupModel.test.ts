import { describe, it, expect } from "vitest";
import { EditorGroupModel } from "../../src/editor/editorGroupModel";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";
import { EditorActivation, EditorGroupChangeKind } from "../../src/editor/editorTypes";

function mk(name: string): PlaceholderEditorInput {
  return new PlaceholderEditorInput(name);
}

describe("EditorGroupModel — empty state", () => {
  it("starts empty with activeIndex -1 and undefined active/preview", () => {
    const g = new EditorGroupModel("g1");
    expect(g.id).toBe("g1");
    expect(g.count).toBe(0);
    expect(g.isEmpty).toBe(true);
    expect(g.activeIndex).toBe(-1);
    expect(g.activeEditor).toBeUndefined();
    expect(g.previewEditor).toBeUndefined();
  });

  it("auto-assigns id when not provided", () => {
    const a = new EditorGroupModel();
    const b = new EditorGroupModel();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^editor-group-\d+$/);
  });
});

describe("EditorGroupModel — openEditor preview semantics", () => {
  it("non-pinned open creates a preview that is replaced by next non-pinned open", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a); // preview
    expect(g.previewEditor).toBe(a);
    expect(g.count).toBe(1);
    g.openEditor(b); // replaces preview
    expect(g.count).toBe(1);
    expect(g.previewEditor).toBe(b);
    expect(g.activeEditor).toBe(b);
  });

  it("pinned open does not replace preview", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a); // preview
    g.openEditor(b, { pinned: true });
    expect(g.count).toBe(2);
    expect(g.previewEditor).toBe(a);
    expect(g.isPinned(b)).toBe(true);
  });

  it("re-opening existing editor with pinned=true pins it", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    g.openEditor(a);
    expect(g.isPinned(a)).toBe(false);
    g.openEditor(a, { pinned: true });
    expect(g.isPinned(a)).toBe(true);
    expect(g.count).toBe(1);
  });

  it("activation=Preserve does not change active editor", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true, activation: EditorActivation.Preserve });
    expect(g.activeEditor).toBe(a);
  });
});

describe("EditorGroupModel — close semantics", () => {
  it("closeEditor on active picks nearest remaining editor as active", async () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    const c = mk("c");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    g.openEditor(c, { pinned: true });
    g.setActive(1); // b active
    await g.closeEditor(1);
    expect(g.count).toBe(2);
    expect(g.activeEditor).toBe(c); // nearest after
  });

  it("closeAllEditors empties the group and sets activeIndex to -1", async () => {
    const g = new EditorGroupModel();
    g.openEditor(mk("a"), { pinned: true });
    g.openEditor(mk("b"), { pinned: true });
    await g.closeAllEditors();
    expect(g.isEmpty).toBe(true);
    expect(g.activeIndex).toBe(-1);
  });

  it("closeOthers pins the kept editor and removes all others", async () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    const c = mk("c");
    g.openEditor(a, { pinned: true });
    g.openEditor(b); // preview
    g.openEditor(c, { pinned: true });
    await g.closeOthers(0);
    expect(g.count).toBe(1);
    expect(g.activeEditor).toBe(a);
    expect(g.isPinned(a)).toBe(true);
  });

  it("closeToTheRight removes only editors to the right of the index", async () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    const c = mk("c");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    g.openEditor(c, { pinned: true });
    await g.closeToTheRight(0);
    expect(g.count).toBe(1);
    expect(g.editors[0]).toBe(a);
  });
});

describe("EditorGroupModel — sticky", () => {
  it("stick moves editor to end of sticky range and implicitly pins it", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    g.stick(1); // stick b
    expect(g.isSticky(b)).toBe(true);
    expect(g.isPinned(b)).toBe(true);
    expect(g.indexOf(b)).toBe(0); // moved to front
  });

  it("unstick moves editor right past the sticky range", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    g.stick(0); // a stays at 0
    g.stick(1); // b moves to index 1 (still sticky)
    expect(g.stickyCount).toBe(2);
    g.unstick(0); // a unstuck → moves past sticky range
    expect(g.isSticky(a)).toBe(false);
    expect(g.indexOf(a)).toBe(1); // past remaining sticky (b)
  });
});

describe("EditorGroupModel — moveEditor", () => {
  it("moveEditor reorders the list and updates activeIndex consistently", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    const c = mk("c");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    g.openEditor(c, { pinned: true });
    g.setActive(2); // c active
    g.moveEditor(2, 0);
    expect(g.editors.map((e) => (e as PlaceholderEditorInput).name)).toEqual(["c", "a", "b"]);
    expect(g.activeEditor).toBe(c);
    expect(g.activeIndex).toBe(0);
  });

  it("moveEditor is a no-op when from===to or out of range", () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    g.openEditor(a, { pinned: true });
    const events: number[] = [];
    g.onDidChange((e) => events.push(e.kind));
    g.moveEditor(0, 0);
    g.moveEditor(5, 0);
    g.moveEditor(0, 5);
    expect(events).toEqual([]);
  });
});

describe("EditorGroupModel — events", () => {
  it("opening fires EditorOpen and (when activating) EditorActive", () => {
    const g = new EditorGroupModel();
    const kinds: number[] = [];
    g.onDidChange((e) => kinds.push(e.kind));
    g.openEditor(mk("a"), { pinned: true });
    expect(kinds).toContain(EditorGroupChangeKind.EditorOpen);
    expect(kinds).toContain(EditorGroupChangeKind.EditorActive);
  });

  it("closing the active editor fires EditorClose then EditorActive", async () => {
    const g = new EditorGroupModel();
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a, { pinned: true });
    g.openEditor(b, { pinned: true });
    const seen: number[] = [];
    g.onDidChange((e) => seen.push(e.kind));
    await g.closeEditor(1); // close active (b)
    const closeIdx = seen.indexOf(EditorGroupChangeKind.EditorClose);
    const activeIdx = seen.indexOf(EditorGroupChangeKind.EditorActive);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThan(closeIdx);
  });
});

describe("EditorGroupModel — serialize", () => {
  it("serialize() preserves order, pinned/sticky flags, and active/preview indices", () => {
    const g = new EditorGroupModel("grp");
    const a = mk("a");
    const b = mk("b");
    g.openEditor(a, { pinned: true });
    g.openEditor(b); // preview, active
    const s = g.serialize();
    expect(s.id).toBe("grp");
    expect(s.activeEditorIndex).toBe(1);
    expect(s.previewEditorIndex).toBe(1);
    expect(s.editors.length).toBe(2);
    expect(s.editors[0].pinned).toBe(true);
    expect(s.editors[1].pinned).toBe(false);
  });
});

describe("EditorGroupModel — dispose", () => {
  it("dispose() empties the group and resets indices", () => {
    const g = new EditorGroupModel();
    g.openEditor(mk("a"), { pinned: true });
    g.openEditor(mk("b"), { pinned: true });
    g.dispose();
    expect(g.count).toBe(0);
    expect(g.activeIndex).toBe(-1);
  });
});
