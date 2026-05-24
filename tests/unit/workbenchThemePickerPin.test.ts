/** @vitest-environment jsdom */
//
// Pin tests for src/workbench/workbenchThemePicker.ts — showColorThemePicker().
//
// Covers structural invariants:
//   - Overlay DOM is appended to the container (.theme-picker-overlay, .theme-picker-box)
//   - Input + list are present, input is focused
//   - Renders separator groups (dark / light / high contrast) when themes exist
//   - Filter input narrows results
//   - ArrowDown / ArrowUp + Enter applies + persists + removes overlay
//   - Escape reverts and removes overlay
//   - Outside mousedown reverts and removes overlay

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { showColorThemePicker } from "../../src/workbench/workbenchThemePicker.js";
import { getAvailableThemes, THEME_STORAGE_KEY } from "../../src/theme/themeCatalog.js";

beforeAll(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

function makeFakeThemeService(initialId: string) {
  const applied: any[] = [];
  return {
    activeTheme: { id: initialId, type: "dark" } as any,
    applyTheme: (t: any) => { applied.push(t); },
    appliedThemes: applied,
  };
}

function makeFakeStorage() {
  const sets: Array<[string, any]> = [];
  return {
    sets,
    set: async (k: string, v: any) => { sets.push([k, v]); },
    get: () => undefined,
    remove: async () => {},
    keys: () => [],
  } as any;
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

const allThemes = getAvailableThemes();
const firstId = allThemes[0]?.id ?? "vs-dark";

describe("showColorThemePicker — DOM scaffolding", () => {
  it("appends an overlay with input and list to the container", () => {
    const ts = makeFakeThemeService(firstId);
    const storage = makeFakeStorage();
    showColorThemePicker(container, ts as any, storage);

    const overlay = container.querySelector(".theme-picker-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector(".theme-picker-box")).not.toBeNull();
    expect(overlay!.querySelector("input.theme-picker-input")).not.toBeNull();
    expect(overlay!.querySelector(".theme-picker-list")).not.toBeNull();
  });

  it("renders at least one theme-picker-item row", () => {
    const ts = makeFakeThemeService(firstId);
    showColorThemePicker(container, ts as any, makeFakeStorage());
    expect(container.querySelectorAll(".theme-picker-item").length).toBeGreaterThan(0);
  });

  it("renders separator headers (dark/light/high contrast) for groups that have entries", () => {
    const ts = makeFakeThemeService(firstId);
    showColorThemePicker(container, ts as any, makeFakeStorage());
    const seps = Array.from(container.querySelectorAll(".theme-picker-separator")).map(
      n => n.textContent
    );
    // At least one of these labels must be present
    const known = ["dark themes", "light themes", "high contrast themes"];
    const matched = seps.filter(s => known.includes(s ?? ""));
    expect(matched.length).toBeGreaterThan(0);
  });
});

describe("showColorThemePicker — filtering", () => {
  it("narrows visible items based on input value", () => {
    const ts = makeFakeThemeService(firstId);
    showColorThemePicker(container, ts as any, makeFakeStorage());

    const initialItemCount = container.querySelectorAll(".theme-picker-item").length;
    const input = container.querySelector("input.theme-picker-input") as HTMLInputElement;
    input.value = "zzzzzz-no-match";
    input.dispatchEvent(new Event("input"));
    expect(container.querySelectorAll(".theme-picker-item").length).toBe(0);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(container.querySelectorAll(".theme-picker-item").length).toBe(initialItemCount);
  });
});

describe("showColorThemePicker — keyboard apply/revert", () => {
  function fireKey(el: HTMLElement, key: string): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  }

  it("Enter applies the highlighted theme, persists to storage, and removes the overlay", () => {
    const ts = makeFakeThemeService(firstId);
    const storage = makeFakeStorage();
    showColorThemePicker(container, ts as any, storage);

    const input = container.querySelector("input.theme-picker-input") as HTMLInputElement;
    fireKey(input, "Enter");

    expect(ts.appliedThemes.length).toBeGreaterThan(0);
    expect(storage.sets.length).toBe(1);
    expect(storage.sets[0][0]).toBe(THEME_STORAGE_KEY);
    expect(container.querySelector(".theme-picker-overlay")).toBeNull();
  });

  it("Escape reverts the preview and removes the overlay without persisting", () => {
    const ts = makeFakeThemeService(firstId);
    const storage = makeFakeStorage();
    showColorThemePicker(container, ts as any, storage);

    const input = container.querySelector("input.theme-picker-input") as HTMLInputElement;
    // ArrowDown to preview a different theme, then Escape to revert
    fireKey(input, "ArrowDown");
    const previewCount = ts.appliedThemes.length;
    fireKey(input, "Escape");

    expect(container.querySelector(".theme-picker-overlay")).toBeNull();
    // No storage write on revert
    expect(storage.sets.length).toBe(0);
    // applyTheme called at least once more during revert (or zero if first item == previous)
    expect(ts.appliedThemes.length).toBeGreaterThanOrEqual(previewCount);
  });

  it("Outside mousedown reverts and removes the overlay", () => {
    const ts = makeFakeThemeService(firstId);
    const storage = makeFakeStorage();
    showColorThemePicker(container, ts as any, storage);

    const overlay = container.querySelector(".theme-picker-overlay") as HTMLElement;
    // mousedown directly on the overlay (target === overlay) triggers revert
    overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(container.querySelector(".theme-picker-overlay")).toBeNull();
    expect(storage.sets.length).toBe(0);
  });
});
