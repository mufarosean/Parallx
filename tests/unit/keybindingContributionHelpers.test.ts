/**
 * Pin-the-invariant: contributions/keybindingContribution.ts pure helpers.
 *   - normalizeKeybinding: canonical sorted modifiers + Cmd→Meta + lowercase.
 *   - keyFromEvent: KeyboardEvent → normalized combo, modifier-only events
 *     produce an empty string.
 *   - formatKeybindingForDisplay: non-Mac path uses "Ctrl/Shift/Alt/Win" tokens.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeKeybinding,
  keyFromEvent,
  formatKeybindingForDisplay,
} from "../../src/contributions/keybindingContribution";

describe("normalizeKeybinding", () => {
  it("lowercases and trims main key, leaves single-key combos unchanged", () => {
    expect(normalizeKeybinding("P")).toBe("p");
    expect(normalizeKeybinding("Enter")).toBe("enter");
  });

  it("sorts modifiers alphabetically: alt < ctrl < meta < shift", () => {
    expect(normalizeKeybinding("Shift+Ctrl+P")).toBe("ctrl+shift+p");
    expect(normalizeKeybinding("Ctrl+Shift+P")).toBe("ctrl+shift+p");
    expect(normalizeKeybinding("Meta+Alt+Shift+Ctrl+K")).toBe(
      "alt+ctrl+meta+shift+k",
    );
  });

  it("maps Cmd / Command / Win / Super onto 'meta'", () => {
    expect(normalizeKeybinding("Cmd+S")).toBe("meta+s");
    expect(normalizeKeybinding("Command+S")).toBe("meta+s");
    expect(normalizeKeybinding("Win+S")).toBe("meta+s");
    expect(normalizeKeybinding("Super+S")).toBe("meta+s");
  });

  it("maps Control / Option aliases", () => {
    expect(normalizeKeybinding("Control+Option+K")).toBe("alt+ctrl+k");
  });

  it("a pure-modifier string yields just the sorted modifiers (no key)", () => {
    expect(normalizeKeybinding("Ctrl+Shift")).toBe("ctrl+shift");
  });
});

describe("keyFromEvent", () => {
  function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      key: "",
      ...over,
    } as KeyboardEvent;
  }

  it("returns an empty string when the pressed key is a bare modifier", () => {
    expect(keyFromEvent(ev({ key: "Control", ctrlKey: true }))).toBe("");
    expect(keyFromEvent(ev({ key: "Shift", shiftKey: true }))).toBe("");
    expect(keyFromEvent(ev({ key: "Alt", altKey: true }))).toBe("");
    expect(keyFromEvent(ev({ key: "Meta", metaKey: true }))).toBe("");
  });

  it("builds an alphabetically-sorted modifier+key combo", () => {
    expect(keyFromEvent(ev({ key: "P", shiftKey: true, ctrlKey: true }))).toBe(
      "ctrl+shift+p",
    );
  });

  it("translates special key names to canonical short forms", () => {
    expect(keyFromEvent(ev({ key: " " }))).toBe("space");
    expect(keyFromEvent(ev({ key: "ArrowUp" }))).toBe("up");
    expect(keyFromEvent(ev({ key: "ArrowDown" }))).toBe("down");
    expect(keyFromEvent(ev({ key: "ArrowLeft" }))).toBe("left");
    expect(keyFromEvent(ev({ key: "ArrowRight" }))).toBe("right");
    expect(keyFromEvent(ev({ key: "Escape" }))).toBe("escape");
    expect(keyFromEvent(ev({ key: "Enter" }))).toBe("enter");
    expect(keyFromEvent(ev({ key: "Tab" }))).toBe("tab");
    expect(keyFromEvent(ev({ key: "Backspace" }))).toBe("backspace");
    expect(keyFromEvent(ev({ key: "Delete" }))).toBe("delete");
  });
});

describe("formatKeybindingForDisplay (non-Mac path)", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "Win32" },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalDescriptor);
    } else {
      delete (globalThis as any).navigator;
    }
  });

  it("renders Ctrl+Shift+P verbatim with '+' separator", () => {
    expect(formatKeybindingForDisplay("Ctrl+Shift+P")).toBe("Ctrl+Shift+P");
  });

  it("renders Meta as 'Win' on non-Mac platforms", () => {
    expect(formatKeybindingForDisplay("Meta+S")).toBe("Win+S");
  });

  it("title-cases non-modifier keys", () => {
    expect(formatKeybindingForDisplay("escape")).toBe("Escape");
  });
});
