/**
 * @vitest-environment jsdom
 *
 * Pin: canvasShortcutsOverlay — modal scaffold, escape/close/click-backdrop
 * resolves, kbd splitting rules, sections render.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { showCanvasShortcutsOverlay } from "../../src/built-in/canvas/canvasShortcutsOverlay";

describe("built-in/canvas/canvasShortcutsOverlay", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("appends backdrop+modal with sections (Block actions, Text formatting, Insert blocks, Sidebar, Help)", () => {
    void showCanvasShortcutsOverlay();
    const titles = [...document.querySelectorAll(".canvas-shortcuts-section-title")]
      .map(el => el.textContent);
    expect(titles).toEqual(["Block actions", "Text formatting", "Insert blocks", "Sidebar", "Help"]);
  });

  it("modal title is 'Keyboard shortcuts' and close button has aria-label='Close'", () => {
    void showCanvasShortcutsOverlay();
    const title = document.querySelector(".canvas-shortcuts-title")!;
    expect(title.textContent).toBe("Keyboard shortcuts");
    const close = document.querySelector(".canvas-shortcuts-close")! as HTMLButtonElement;
    expect(close.type).toBe("button");
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(close.textContent).toBe("×");
  });

  it("Help section contains exactly Ctrl+/ → Show this list", () => {
    void showCanvasShortcutsOverlay();
    const sections = [...document.querySelectorAll(".canvas-shortcuts-section")];
    const help = sections.find(s => s.querySelector(".canvas-shortcuts-section-title")?.textContent === "Help")!;
    const rows = [...help.querySelectorAll(".canvas-shortcuts-row")];
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".canvas-shortcuts-label")?.textContent).toBe("Show this list");
    const kbds = [...rows[0].querySelectorAll("kbd.canvas-shortcuts-kbd")].map(k => k.textContent);
    expect(kbds).toEqual(["Ctrl"]); // formatKeys splits on '/' so trailing '/' becomes an empty token (filtered)
  });

  it("Ctrl+Shift+S renders as three kbd tokens", () => {
    void showCanvasShortcutsOverlay();
    const rows = [...document.querySelectorAll(".canvas-shortcuts-row")];
    const strike = rows.find(r => r.querySelector(".canvas-shortcuts-label")?.textContent === "Strikethrough")!;
    const kbds = [...strike.querySelectorAll("kbd.canvas-shortcuts-kbd")].map(k => k.textContent);
    expect(kbds).toEqual(["Ctrl", "Shift", "S"]);
  });

  it("'# Space' splits on whitespace into [#, Space] kbds", () => {
    void showCanvasShortcutsOverlay();
    const rows = [...document.querySelectorAll(".canvas-shortcuts-row")];
    const h1 = rows.find(r => r.querySelector(".canvas-shortcuts-label")?.textContent === "Heading 1")!;
    const kbds = [...h1.querySelectorAll("kbd.canvas-shortcuts-kbd")].map(k => k.textContent);
    expect(kbds).toEqual(["#", "Space"]);
  });

  it("'Shift+↑ / Shift+↓' splits on '/' AND '+' into four kbds", () => {
    void showCanvasShortcutsOverlay();
    const rows = [...document.querySelectorAll(".canvas-shortcuts-row")];
    const extend = rows.find(r => r.querySelector(".canvas-shortcuts-label")?.textContent === "Extend block selection")!;
    const kbds = [...extend.querySelectorAll("kbd.canvas-shortcuts-kbd")].map(k => k.textContent);
    expect(kbds).toEqual(["Shift", "↑", "Shift", "↓"]);
  });

  it("Escape resolves the promise and removes the backdrop", async () => {
    const p = showCanvasShortcutsOverlay();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
    expect(document.querySelector(".canvas-shortcuts-backdrop")).toBeNull();
  });

  it("close button click resolves and tears down", async () => {
    const p = showCanvasShortcutsOverlay();
    (document.querySelector(".canvas-shortcuts-close") as HTMLButtonElement).click();
    await p;
    expect(document.querySelector(".canvas-shortcuts-backdrop")).toBeNull();
  });

  it("clicking the backdrop (but not the modal) resolves", async () => {
    const p = showCanvasShortcutsOverlay();
    const backdrop = document.querySelector(".canvas-shortcuts-backdrop") as HTMLElement;
    // Click on backdrop itself (target===backdrop)
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await p;
    expect(document.querySelector(".canvas-shortcuts-backdrop")).toBeNull();
  });

  it("clicking inside the modal does NOT close it", async () => {
    let resolved = false;
    const p = showCanvasShortcutsOverlay().then(() => { resolved = true; });
    const modal = document.querySelector(".canvas-shortcuts-modal") as HTMLElement;
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Give the microtask queue a tick — promise should NOT have resolved.
    await Promise.resolve();
    expect(resolved).toBe(false);
    // Close it for cleanup.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });
});
