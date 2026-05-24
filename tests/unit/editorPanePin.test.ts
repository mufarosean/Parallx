/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { EditorPane, PlaceholderEditorPane } from "../../src/editor/editorPane";

class TestPane extends EditorPane {
  rendered: any[] = [];
  cleared = 0;
  laid: Array<[number, number]> = [];
  state: Record<string, unknown> = {};
  restored: Record<string, unknown> | null = null;

  constructor() {
    super("test-pane");
  }
  protected createPaneContent(container: HTMLElement): void {
    container.classList.add("test-pane-body");
  }
  protected async renderInput(input: any, previous: any): Promise<void> {
    this.rendered.push({ input, previous });
  }
  protected override clearPaneContent(): void {
    this.cleared++;
  }
  protected override layoutPaneContent(w: number, h: number): void {
    this.laid.push([w, h]);
  }
  protected override savePaneViewState() {
    return this.state;
  }
  protected override restorePaneViewState(s: Record<string, unknown>) {
    this.restored = s;
  }
  fire() {
    this.fireViewStateChanged();
  }
}

describe("EditorPane pin", () => {
  it("id defaults to auto-incrementing 'editor-pane-N' when not provided", () => {
    class P extends TestPane {
      constructor() { super(); (this as any).id = undefined; }
    }
    // Instead, use an unnamed pane via the constructor:
    class Unnamed extends EditorPane {
      constructor() { super(); }
      protected createPaneContent() {}
      protected async renderInput() {}
    }
    const a = new Unnamed();
    const b = new Unnamed();
    expect(a.id).toMatch(/^editor-pane-\d+$/);
    expect(b.id).toMatch(/^editor-pane-\d+$/);
    expect(a.id).not.toBe(b.id);
    a.dispose(); b.dispose();
  });

  it("explicit id is honoured", () => {
    const p = new TestPane();
    expect(p.id).toBe("test-pane");
    p.dispose();
  });

  it("create() builds .editor-pane.fill-container DOM and is idempotent", () => {
    const p = new TestPane();
    const host = document.createElement("div");
    p.create(host);

    expect(p.element).toBeDefined();
    expect(p.element!.classList.contains("editor-pane")).toBe(true);
    expect(p.element!.classList.contains("fill-container")).toBe(true);
    expect(p.element!.classList.contains("test-pane-body")).toBe(true);
    expect(host.children.length).toBe(1);

    // Second create is a no-op
    p.create(host);
    expect(host.children.length).toBe(1);
    p.dispose();
  });

  it("setInput() stores input and passes previous to renderInput()", async () => {
    const p = new TestPane();
    const inputA = { name: "a", description: "" } as any;
    const inputB = { name: "b", description: "" } as any;

    await p.setInput(inputA);
    expect(p.input).toBe(inputA);
    expect(p.rendered[0]).toEqual({ input: inputA, previous: undefined });

    await p.setInput(inputB);
    expect(p.input).toBe(inputB);
    expect(p.rendered[1]).toEqual({ input: inputB, previous: inputA });
    p.dispose();
  });

  it("clearInput() drops input and invokes clearPaneContent()", async () => {
    const p = new TestPane();
    await p.setInput({ name: "x" } as any);
    p.clearInput();
    expect(p.input).toBeUndefined();
    expect(p.cleared).toBe(1);
    p.dispose();
  });

  it("layout() sets width/height styles and forwards to layoutPaneContent()", () => {
    const p = new TestPane();
    p.create(document.createElement("div"));
    p.layout(640, 480);
    expect(p.width).toBe(640);
    expect(p.height).toBe(480);
    expect(p.element!.style.width).toBe("640px");
    expect(p.element!.style.height).toBe("480px");
    expect(p.laid).toEqual([[640, 480]]);
    p.dispose();
  });

  it("saveViewState/restoreViewState delegate to pane hooks", () => {
    const p = new TestPane();
    p.state = { scroll: 42 };
    expect(p.saveViewState()).toEqual({ scroll: 42 });

    p.restoreViewState({ scroll: 99 });
    expect(p.restored).toEqual({ scroll: 99 });
    p.dispose();
  });

  it("fireViewStateChanged() emits on onDidChangeViewState", () => {
    const p = new TestPane();
    const seen = vi.fn();
    p.onDidChangeViewState(seen);
    p.fire();
    p.fire();
    expect(seen).toHaveBeenCalledTimes(2);
    p.dispose();
  });
});

describe("PlaceholderEditorPane pin", () => {
  it("id is 'placeholder-pane' and renders default label 'No editor' before any input", () => {
    const p = new PlaceholderEditorPane();
    expect(p.id).toBe("placeholder-pane");
    const host = document.createElement("div");
    p.create(host);
    expect(p.element!.classList.contains("placeholder-pane-content")).toBe(true);
    const label = p.element!.querySelector(".placeholder-pane-label") as HTMLElement;
    expect(label.textContent).toBe("No editor");
    p.dispose();
  });

  it("renderInput shows name; with description shows 'name\\ndescription'", async () => {
    const p = new PlaceholderEditorPane();
    p.create(document.createElement("div"));
    const label = p.element!.querySelector(".placeholder-pane-label") as HTMLElement;

    await p.setInput({ name: "Foo", description: "" } as any);
    expect(label.textContent).toBe("Foo");

    await p.setInput({ name: "Foo", description: "bar.ts" } as any);
    expect(label.textContent).toBe("Foo\nbar.ts");
    p.dispose();
  });

  it("clearInput resets label to 'No editor'", async () => {
    const p = new PlaceholderEditorPane();
    p.create(document.createElement("div"));
    await p.setInput({ name: "X", description: "" } as any);
    p.clearInput();
    const label = p.element!.querySelector(".placeholder-pane-label") as HTMLElement;
    expect(label.textContent).toBe("No editor");
    p.dispose();
  });
});
