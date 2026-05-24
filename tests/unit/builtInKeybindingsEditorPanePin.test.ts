/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/keybindingsEditorPane.ts.
 *
 * Pins:
 *   - constructor stores KeybindingsProvider; pane id is 'keybindings-editor-pane'.
 *   - createPaneContent installs `.keybindings-editor` with header (h2 'Keyboard Shortcuts',
 *     search input, count label), table with 4 columns (Command/Keybinding/Source/When),
 *     and a hidden `.keybindings-editor-empty` 'No keybindings match your search.'.
 *   - setInput pulls entries from provider, sorts by commandId, renders one row per entry,
 *     count label is '<N> keybindings'.
 *   - typing into the search filters by commandId/key/source/when (case-insensitive);
 *     count label becomes '<filtered> of <total>'.
 *   - empty filter result reveals the empty message.
 *   - clearInput resets table body, search input and entry list.
 *   - focus() focuses the search input.
 */
import { describe, it, expect, vi } from "vitest";
import { KeybindingsEditorPane, type KeybindingEntry } from "../../src/built-in/editor/keybindingsEditorPane";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";

function mount(entries: KeybindingEntry[] = []) {
  const provider = vi.fn(() => entries);
  const pane = new KeybindingsEditorPane(provider);
  const root = document.createElement("div");
  document.body.appendChild(root);
  pane.create(root);
  return { pane, root, provider };
}

describe("built-in/editor/keybindingsEditorPane", () => {
  it("createPaneContent installs header, search input, count label, table headers, hidden empty message", () => {
    const { pane } = mount();
    const el = pane.element!;
    expect(el.querySelector(".keybindings-editor")).toBeTruthy();
    expect(el.querySelector("h2")?.textContent).toBe("Keyboard Shortcuts");
    const search = el.querySelector("input.keybindings-search-input") as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(search.type).toBe("text");
    expect(search.placeholder).toMatch(/Type to search/);
    expect(el.querySelector(".keybindings-result-count")).toBeTruthy();
    const ths = Array.from(el.querySelectorAll("thead th")).map((t) => t.textContent);
    expect(ths).toEqual(["Command", "Keybinding", "Source", "When"]);
    const empty = el.querySelector(".keybindings-editor-empty") as HTMLElement;
    expect(empty.textContent).toBe("No keybindings match your search.");
    expect(empty.style.display).toBe("none");
  });

  it("setInput renders one row per entry, sorted by commandId; count = '<N> keybindings'", async () => {
    const entries: KeybindingEntry[] = [
      { commandId: "z.cmd", key: "ctrl+z", source: "core" },
      { commandId: "a.cmd", key: "ctrl+a", source: "ext", when: "editorFocus" },
    ];
    const { pane } = mount(entries);
    await pane.setInput(new PlaceholderEditorInput("x"));
    const rows = pane.element!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll("td")[0].textContent).toBe("a.cmd");
    expect(rows[1].querySelectorAll("td")[0].textContent).toBe("z.cmd");
    const count = pane.element!.querySelector(".keybindings-result-count");
    expect(count?.textContent).toBe("2 keybindings");
  });

  it("typing in the search filters case-insensitively across command/key/source/when", async () => {
    const entries: KeybindingEntry[] = [
      { commandId: "editor.save", key: "ctrl+s", source: "core" },
      { commandId: "explorer.open", key: "ctrl+o", source: "ext", when: "panelVisible" },
      { commandId: "noise.fluffy", key: "alt+f", source: "ext" },
    ];
    const { pane } = mount(entries);
    await pane.setInput(new PlaceholderEditorInput("x"));
    const search = pane.element!.querySelector("input.keybindings-search-input") as HTMLInputElement;
    search.value = "PANELVISIBLE";
    search.dispatchEvent(new Event("input"));
    const rows = pane.element!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelectorAll("td")[0].textContent).toBe("explorer.open");
    const count = pane.element!.querySelector(".keybindings-result-count");
    expect(count?.textContent).toBe("1 of 3");
  });

  it("zero-match filter reveals the empty message", async () => {
    const entries: KeybindingEntry[] = [{ commandId: "a", key: "ctrl+a" }];
    const { pane } = mount(entries);
    await pane.setInput(new PlaceholderEditorInput("x"));
    const search = pane.element!.querySelector("input.keybindings-search-input") as HTMLInputElement;
    search.value = "no-such-thing";
    search.dispatchEvent(new Event("input"));
    const empty = pane.element!.querySelector(".keybindings-editor-empty") as HTMLElement;
    expect(empty.style.display).toBe("flex");
    expect(pane.element!.querySelectorAll("tbody tr").length).toBe(0);
  });

  it("clearInput resets the table body, search input value and entries", async () => {
    const entries: KeybindingEntry[] = [{ commandId: "a", key: "ctrl+a" }];
    const { pane } = mount(entries);
    await pane.setInput(new PlaceholderEditorInput("x"));
    const search = pane.element!.querySelector("input.keybindings-search-input") as HTMLInputElement;
    search.value = "abc";
    pane.clearInput();
    expect(search.value).toBe("");
    expect(pane.element!.querySelectorAll("tbody tr").length).toBe(0);
  });

  it("focus() focuses the search input", () => {
    const { pane } = mount();
    const search = pane.element!.querySelector("input.keybindings-search-input") as HTMLInputElement;
    pane.focus();
    expect(document.activeElement).toBe(search);
  });
});
