/**
 * @vitest-environment jsdom
 */
// workbenchWatermarkPin.test.ts — pin editor watermark render contract.

import { describe, it, expect } from "vitest";
import {
  setupEditorWatermark,
  updateWatermarkKeybindings,
} from "../../src/workbench/workbenchWatermark";

function makeRoot(): { root: HTMLElement; watermark: HTMLElement } {
  const root = document.createElement("div");
  const watermark = document.createElement("div");
  watermark.className = "editor-watermark";
  root.appendChild(watermark);
  return { root, watermark };
}

describe("workbenchWatermark", () => {
  it("setupEditorWatermark is a no-op when no .editor-watermark child exists", () => {
    const root = document.createElement("div");
    expect(() => setupEditorWatermark(root)).not.toThrow();
    expect(root.innerHTML).toBe("");
  });

  it("setupEditorWatermark renders the default four shortcut entries with fallback keys", () => {
    const { root, watermark } = makeRoot();
    setupEditorWatermark(root);
    expect(watermark.querySelectorAll(".editor-watermark-entry").length).toBe(4);
    const labels = Array.from(watermark.querySelectorAll(".editor-watermark-entry span")).map(s => s.textContent);
    expect(labels).toEqual([
      "Command Palette",
      "Toggle Sidebar",
      "Toggle Panel",
      "Split Editor",
    ]);
    const keys = Array.from(watermark.querySelectorAll(".editor-watermark-entry kbd")).map(k => k.textContent);
    expect(keys).toEqual(["Ctrl+Shift+P", "Ctrl+B", "Ctrl+J", "Ctrl+\\"]);
  });

  it("renders the static title and icon", () => {
    const { root, watermark } = makeRoot();
    setupEditorWatermark(root);
    expect(watermark.querySelector(".editor-watermark-title")?.textContent).toBe("Parallx Workbench");
    expect(watermark.querySelector(".editor-watermark-icon svg")).not.toBeNull();
  });

  it("updateWatermarkKeybindings uses keybinding service-resolved keys when present", () => {
    const { root, watermark } = makeRoot();
    setupEditorWatermark(root);
    const service = {
      lookupKeybinding: (id: string) => {
        if (id === "workbench.action.showCommands") return "ctrl+k";
        return undefined;
      },
    };
    updateWatermarkKeybindings(root, service);
    const keys = Array.from(watermark.querySelectorAll(".editor-watermark-entry kbd")).map(k => k.textContent);
    // First entry uses service, rest fall back.
    expect(keys[0]).toBe("Ctrl+K");
    expect(keys[1]).toBe("Ctrl+B");
  });

  it("updateWatermarkKeybindings capitalises each '+'-separated segment", () => {
    const { root, watermark } = makeRoot();
    setupEditorWatermark(root);
    const service = { lookupKeybinding: () => "ctrl+shift+p" };
    updateWatermarkKeybindings(root, service);
    const keys = Array.from(watermark.querySelectorAll(".editor-watermark-entry kbd")).map(k => k.textContent);
    expect(keys[0]).toBe("Ctrl+Shift+P");
  });

  it("updateWatermarkKeybindings is a no-op when no watermark element is present", () => {
    const root = document.createElement("div");
    expect(() =>
      updateWatermarkKeybindings(root, { lookupKeybinding: () => "ctrl+x" }),
    ).not.toThrow();
  });
});
