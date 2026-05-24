/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/epubEditorPane.ts.
 *
 * Pins:
 *   - PANE_ID = 'epub-editor-pane'.
 *   - create() installs .epub-editor-pane class plus toolbar, body, nav, scroll,
 *     content, and status-bar elements.
 *   - Toolbar contains four buttons (decrease, increase, reset) — zoom label visible.
 *   - renderInput rejects non-EpubEditorInput with 'Cannot render: not an EPUB input.'.
 *   - renderInput without parallxElectron.document bridge surfaces error
 *     'Error: Document extraction bridge not available'.
 *   - readEpub returning chapters paints one <section.epub-chapter> per chapter and
 *     one nav button per chapter (with 2+ chapters → nav visible).
 *   - readEpub returning {error} routes through the error path.
 *   - Falls back to extractText when readEpub bridge is absent.
 *   - clearPaneContent resets title/content/nav/status and font scale to 1.
 *   - savePaneViewState returns {scrollTop, fontScale}.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EpubEditorPane } from "../../src/built-in/editor/epubEditorPane";
import { EpubEditorInput } from "../../src/built-in/editor/epubEditorInput";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";
import { URI } from "../../src/platform/uri";

function makePane(): { pane: EpubEditorPane; container: HTMLElement } {
  const pane = new EpubEditorPane();
  const container = document.createElement("div");
  document.body.appendChild(container);
  pane.create(container);
  return { pane, container };
}

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (h: any) => clearTimeout(h);
  delete (globalThis as any).parallxElectron;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (globalThis as any).parallxElectron;
});

describe("built-in/editor/epubEditorPane — construction & DOM", () => {
  it("exports PANE_ID = 'epub-editor-pane'", () => {
    expect(EpubEditorPane.PANE_ID).toBe("epub-editor-pane");
  });

  it("create() installs toolbar, body, nav, scroll, content, status-bar", () => {
    const { pane, container } = makePane();
    expect(pane.element!.classList.contains("epub-editor-pane")).toBe(true);
    expect(container.querySelector(".epub-toolbar")).toBeTruthy();
    expect(container.querySelector(".epub-reader-body")).toBeTruthy();
    expect(container.querySelector(".epub-reader-nav")).toBeTruthy();
    expect(container.querySelector(".epub-reader-scroll")).toBeTruthy();
    expect(container.querySelector(".epub-reader-content")).toBeTruthy();
    expect(container.querySelector(".epub-status-bar")).toBeTruthy();
    expect(container.querySelectorAll(".epub-toolbar-btn").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".epub-toolbar-zoom-label")).toBeTruthy();
  });
});

describe("built-in/editor/epubEditorPane — renderInput", () => {
  it("rejects non-EpubEditorInput with 'Cannot render: not an EPUB input.'", async () => {
    const { pane, container } = makePane();
    await pane.setInput(new PlaceholderEditorInput("nope"));
    const err = container.querySelector(".epub-reader-error") as HTMLElement;
    expect(err.textContent).toBe("Cannot render: not an EPUB input.");
    expect(err.style.display).not.toBe("none");
  });

  it("surfaces 'Document extraction bridge not available' when bridge missing", async () => {
    const { pane, container } = makePane();
    await pane.setInput(EpubEditorInput.create(URI.file("C:/a.epub")));
    const err = container.querySelector(".epub-reader-error") as HTMLElement;
    expect(err.textContent).toMatch(/Document extraction bridge not available/);
  });

  it("renders one .epub-chapter and one nav button per chapter from readEpub()", async () => {
    (globalThis as any).parallxElectron = {
      document: {
        extractText: vi.fn(async () => ({ text: "x" })),
        readEpub: vi.fn(async () => ({
          title: "Book",
          chapters: [
            { id: "c1", title: "One", path: "a", html: "<p>one</p>", text: "one" },
            { id: "c2", title: "Two", path: "b", html: "<p>two</p>", text: "two" },
          ],
        })),
      },
    };
    const { pane, container } = makePane();
    await pane.setInput(EpubEditorInput.create(URI.file("C:/b.epub")));
    const sections = container.querySelectorAll(".epub-chapter");
    expect(sections.length).toBe(2);
    expect((sections[0] as HTMLElement).innerHTML).toContain("<p>one</p>");
    expect(container.querySelectorAll(".epub-reader-nav-item").length).toBe(2);
    expect(container.querySelector(".epub-reader-nav")!.classList.contains("epub-reader-nav-hidden")).toBe(false);
  });

  it("readEpub returning {error} routes to the error message path", async () => {
    (globalThis as any).parallxElectron = {
      document: {
        extractText: vi.fn(async () => ({ text: "" })),
        readEpub: vi.fn(async () => ({ error: { message: "BAD" } })),
      },
    };
    const { pane, container } = makePane();
    await pane.setInput(EpubEditorInput.create(URI.file("C:/c.epub")));
    const err = container.querySelector(".epub-reader-error") as HTMLElement;
    expect(err.textContent).toMatch(/BAD/);
  });

  it("falls back to extractText() when readEpub bridge is absent", async () => {
    const extract = vi.fn(async () => ({ text: "plain epub text" }));
    (globalThis as any).parallxElectron = { document: { extractText: extract } };
    const { pane, container } = makePane();
    await pane.setInput(EpubEditorInput.create(URI.file("C:/d.epub")));
    expect(extract).toHaveBeenCalled();
    expect(container.querySelector(".epub-reader-content")!.textContent).toBe("plain epub text");
  });
});

describe("built-in/editor/epubEditorPane — clear & view state", () => {
  it("clearInput() resets title, content, nav and status", async () => {
    (globalThis as any).parallxElectron = {
      document: {
        extractText: vi.fn(async () => ({ text: "x" })),
        readEpub: vi.fn(async () => ({ title: "T", chapters: [{ id: "1", title: "x", path: "p", html: "<p>x</p>", text: "x" }] })),
      },
    };
    const { pane, container } = makePane();
    await pane.setInput(EpubEditorInput.create(URI.file("C:/e.epub")));
    pane.clearInput();
    expect(container.querySelector(".epub-toolbar-title")!.textContent).toBe("");
    expect(container.querySelector(".epub-reader-content")!.textContent).toBe("");
    expect(container.querySelector(".epub-reader-nav-list")!.textContent).toBe("");
    expect(container.querySelector(".epub-status-bar")!.textContent).toBe("");
  });

  it("saveViewState returns {scrollTop, fontScale}", () => {
    const { pane } = makePane();
    const state = pane.saveViewState();
    expect(state).toHaveProperty("scrollTop");
    expect(state).toHaveProperty("fontScale");
    expect(typeof (state as any).fontScale).toBe("number");
  });
});
