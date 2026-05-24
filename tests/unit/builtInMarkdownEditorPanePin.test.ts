/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/markdownEditorPane.ts.
 *
 * Pins:
 *   - PANE_ID = 'markdown-editor-pane'; class is on pane.element.
 *   - create() installs .markdown-scroll-container > .markdown-content.
 *   - renderInput rejects non-markdown inputs with 'Cannot render: not a markdown input.'.
 *   - ReadonlyMarkdownInput renders content as HTML and re-renders on updateContent.
 *   - Selection helpers: getSelectedText() returns undefined when nothing is selected;
 *     getSelectionSource() returns undefined without a selection.
 *   - layout(width, height) sizes the scroll container exactly.
 *   - clearInput() empties the content element.
 *   - Markdown rendering: code blocks use highlight.js when language is known;
 *     plain text is converted (e.g. `**bold**` → `<strong>`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MarkdownEditorPane } from "../../src/built-in/editor/markdownEditorPane";
import { ReadonlyMarkdownInput } from "../../src/built-in/editor/readonlyMarkdownInput";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";

function makePane(): { pane: MarkdownEditorPane; container: HTMLElement } {
  const pane = new MarkdownEditorPane();
  const container = document.createElement("div");
  document.body.appendChild(container);
  pane.create(container);
  return { pane, container };
}

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("built-in/editor/markdownEditorPane — construction", () => {
  it("exports PANE_ID = 'markdown-editor-pane'", () => {
    expect(MarkdownEditorPane.PANE_ID).toBe("markdown-editor-pane");
  });

  it("create() installs .markdown-editor-pane class and scroll/content elements", () => {
    const { pane, container } = makePane();
    expect(pane.element!.classList.contains("markdown-editor-pane")).toBe(true);
    expect(container.contains(pane.element!)).toBe(true);
    expect(container.querySelector(".markdown-scroll-container")).toBeTruthy();
    expect(container.querySelector(".markdown-content")).toBeTruthy();
  });
});

describe("built-in/editor/markdownEditorPane — renderInput", () => {
  it("rejects non-markdown input with 'Cannot render: not a markdown input.'", async () => {
    const { pane, container } = makePane();
    await pane.setInput(new PlaceholderEditorInput("Not markdown"));
    const content = container.querySelector(".markdown-content")!;
    expect(content.textContent).toBe("Cannot render: not a markdown input.");
  });

  it("renders ReadonlyMarkdownInput content as HTML", async () => {
    const { pane, container } = makePane();
    const input = ReadonlyMarkdownInput.create("**bold** _italic_", "test.md");
    await pane.setInput(input);
    const html = (container.querySelector(".markdown-content") as HTMLElement).innerHTML;
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("re-renders when ReadonlyMarkdownInput fires onDidChangeContent", async () => {
    const { pane, container } = makePane();
    const input = ReadonlyMarkdownInput.create("first", "n.md");
    await pane.setInput(input);
    expect(container.querySelector(".markdown-content")!.textContent).toContain("first");
    input.updateContent("# second");
    const after = container.querySelector(".markdown-content") as HTMLElement;
    expect(after.querySelector("h1")?.textContent).toBe("second");
  });

  it("renders fenced code with highlight.js syntax classes when language is known", async () => {
    const { pane, container } = makePane();
    const src = "```js\nconst x = 1;\n```";
    const input = ReadonlyMarkdownInput.create(src, "c.md");
    await pane.setInput(input);
    const html = (container.querySelector(".markdown-content") as HTMLElement).innerHTML;
    expect(html).toContain("hljs-keyword");
  });
});

describe("built-in/editor/markdownEditorPane — selection helpers (M48)", () => {
  it("getSelectedText() returns undefined when no text is selected", () => {
    const { pane } = makePane();
    expect(pane.getSelectedText()).toBeUndefined();
  });

  it("getSelectionSource() returns undefined when no text is selected", () => {
    const { pane } = makePane();
    expect(pane.getSelectionSource()).toBeUndefined();
  });
});

describe("built-in/editor/markdownEditorPane — layout & clear", () => {
  it("layoutPaneContent sizes the scroll container to width/height", () => {
    const { pane, container } = makePane();
    pane.layout(640, 480);
    const scroll = container.querySelector(".markdown-scroll-container") as HTMLElement;
    expect(scroll.style.width).toBe("640px");
    expect(scroll.style.height).toBe("480px");
  });

  it("clearInput() empties the .markdown-content element", async () => {
    const { pane, container } = makePane();
    await pane.setInput(ReadonlyMarkdownInput.create("hello", "x.md"));
    expect(container.querySelector(".markdown-content")!.innerHTML).not.toBe("");
    pane.clearInput();
    expect(container.querySelector(".markdown-content")!.innerHTML).toBe("");
  });
});
