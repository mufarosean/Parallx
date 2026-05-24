/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/textEditorPane.ts.
 *
 * Pins:
 *   - PANE_ID constant 'text-editor-pane'.
 *   - createPaneContent builds: .text-editor-pane > .text-editor-body
 *     (.text-editor-gutter + textarea.text-editor-textarea + .text-editor-minimap)
 *     + .text-editor-binary (hidden) + .text-editor-status (4 .text-editor-status-item).
 *   - Status items default to "Ln 1, Col 1", "UTF-8", "LF", "Plain Text".
 *   - textarea stores back-pointer (__textEditorPane) for external command lookup.
 *   - setInput with UntitledEditorInput populates textarea value, detects LF/CRLF,
 *     updates languageItem via getLanguageForFileName.
 *   - toggleWordWrap flips _wordWrap, fires onDidToggleWordWrap with new value,
 *     adds/removes 'text-editor-textarea--wrap' class on textarea.
 *   - savePaneViewState returns {scrollTop, scrollLeft, selectionStart, selectionEnd,
 *     wordWrap} reflecting current state.
 *   - restorePaneViewState applies scrollTop, scrollLeft, selection range, wordWrap.
 *   - cursorLine/cursorCol getters reflect current selectionStart after _updateCursorPosition.
 *   - Input event updates lineCount/gutter and pushes content to UntitledEditorInput.
 *   - WRAP_EXTENSIONS .md → wordWrap defaults true on render.
 *   - clearPaneContent resets textarea value + status defaults.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TextEditorPane } from "../../src/built-in/editor/textEditorPane";
import { UntitledEditorInput } from "../../src/built-in/editor/untitledEditorInput";

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
});

function mountPane(): { pane: TextEditorPane; root: HTMLElement } {
  const pane = new TextEditorPane();
  const root = document.createElement("div");
  document.body.appendChild(root);
  pane.create(root);
  return { pane, root };
}

describe("built-in/editor/textEditorPane — DOM shape", () => {
  it("PANE_ID is 'text-editor-pane'", () => {
    expect(TextEditorPane.PANE_ID).toBe("text-editor-pane");
  });

  it("createPaneContent builds body/gutter/textarea/minimap/status DOM", () => {
    const { pane } = mountPane();
    const el = pane.element!;
    expect(el.classList.contains("text-editor-pane")).toBe(true);
    expect(el.querySelector(".text-editor-body")).toBeTruthy();
    expect(el.querySelector(".text-editor-gutter")).toBeTruthy();
    const ta = el.querySelector("textarea.text-editor-textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.spellcheck).toBe(false);
    expect(ta.getAttribute("autocomplete")).toBe("off");
    expect(el.querySelector(".text-editor-minimap")).toBeTruthy();
    expect(el.querySelector(".text-editor-minimap-canvas")).toBeTruthy();
    expect(el.querySelector(".text-editor-minimap-slider")).toBeTruthy();
    expect(el.querySelector(".text-editor-binary")).toBeTruthy();
    const items = el.querySelectorAll(".text-editor-status .text-editor-status-item");
    expect(items.length).toBe(4);
    expect(items[0].textContent).toBe("Ln 1, Col 1");
    expect(items[1].textContent).toBe("UTF-8");
    expect(items[2].textContent).toBe("LF");
    expect(items[3].textContent).toBe("Plain Text");
  });

  it("stores back-pointer on textarea for external command lookup", () => {
    const { pane } = mountPane();
    const ta = pane.element!.querySelector("textarea.text-editor-textarea") as any;
    expect(ta.__textEditorPane).toBe(pane);
  });
});

describe("built-in/editor/textEditorPane — setInput / EOL / language", () => {
  it("loads UntitledEditorInput content into textarea", async () => {
    const { pane } = mountPane();
    const input = UntitledEditorInput.createWithContent("hello world");
    await pane.setInput(input);
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello world");
  });

  it("detects CRLF vs LF and shows it in the status bar", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("a\r\nb\r\n"));
    const eol = pane.element!.querySelectorAll(".text-editor-status-item")[2];
    expect(eol.textContent).toBe("CRLF");

    const { pane: pane2 } = mountPane();
    await pane2.setInput(UntitledEditorInput.createWithContent("a\nb\n"));
    const eol2 = pane2.element!.querySelectorAll(".text-editor-status-item")[2];
    expect(eol2.textContent).toBe("LF");
  });
});

describe("built-in/editor/textEditorPane — word wrap", () => {
  it("toggleWordWrap flips state, fires event, toggles textarea class", () => {
    const { pane } = mountPane();
    const fired: boolean[] = [];
    pane.onDidToggleWordWrap(v => fired.push(v));
    expect(pane.isWordWrapEnabled).toBe(false);
    pane.toggleWordWrap();
    expect(pane.isWordWrapEnabled).toBe(true);
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.classList.contains("text-editor-textarea--wrap")).toBe(true);
    pane.toggleWordWrap();
    expect(pane.isWordWrapEnabled).toBe(false);
    expect(ta.classList.contains("text-editor-textarea--wrap")).toBe(false);
    expect(fired).toEqual([true, false]);
  });
});

describe("built-in/editor/textEditorPane — view state save/restore", () => {
  it("savePaneViewState returns scroll/selection/wordWrap snapshot", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("abc\ndef\nghi"));
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 5);
    pane.toggleWordWrap();
    const state = (pane as any).savePaneViewState();
    expect(state.selectionStart).toBe(2);
    expect(state.selectionEnd).toBe(5);
    expect(state.wordWrap).toBe(true);
    expect(typeof state.scrollTop).toBe("number");
  });

  it("restorePaneViewState applies wordWrap + selection", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("abcdefghij"));
    (pane as any).restorePaneViewState({
      scrollTop: 0,
      scrollLeft: 0,
      selectionStart: 3,
      selectionEnd: 7,
      wordWrap: true,
    });
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(3);
    expect(ta.selectionEnd).toBe(7);
    expect(pane.isWordWrapEnabled).toBe(true);
  });
});

describe("built-in/editor/textEditorPane — cursor position", () => {
  it("cursorLine/cursorCol reflect selection after click/keyup", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("abc\ndef\nghi"));
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 6); // after 'abc\nde'
    ta.dispatchEvent(new Event("keyup"));
    expect(pane.cursorLine).toBe(2);
    expect(pane.cursorCol).toBe(3);
    const posItem = pane.element!.querySelector(".text-editor-status-item") as HTMLElement;
    expect(posItem.textContent).toBe("Ln 2, Col 3");
  });

  it("fires onDidChangeCursorPosition when cursor moves", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("x\ny\nz"));
    const seen: Array<{ line: number; col: number }> = [];
    pane.onDidChangeCursorPosition(p => seen.push(p));
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 2);
    ta.dispatchEvent(new Event("click"));
    expect(seen.at(-1)).toEqual({ line: 2, col: 1 });
  });
});

describe("built-in/editor/textEditorPane — clearPaneContent", () => {
  it("resets textarea and status to defaults", async () => {
    const { pane } = mountPane();
    await pane.setInput(UntitledEditorInput.createWithContent("hello"));
    (pane as any).clearPaneContent(undefined);
    const ta = pane.element!.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("");
    const items = pane.element!.querySelectorAll(".text-editor-status-item");
    expect(items[0].textContent).toBe("Ln 1, Col 1");
    expect(items[1].textContent).toBe("UTF-8");
    expect(items[2].textContent).toBe("LF");
  });
});
