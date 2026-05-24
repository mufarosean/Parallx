/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeKeybinding,
  formatKeybindingForDisplay,
  keyFromEvent,
} from "../../src/contributions/keybindingContribution";

describe("normalizeKeybinding", () => {
  it("lowercases all parts", () => {
    expect(normalizeKeybinding("Ctrl+P")).toBe("ctrl+p");
    expect(normalizeKeybinding("SHIFT+A")).toBe("shift+a");
  });

  it("sorts modifiers alphabetically with the main key at the end", () => {
    expect(normalizeKeybinding("Ctrl+Shift+P")).toBe("ctrl+shift+p");
    expect(normalizeKeybinding("Shift+Ctrl+P")).toBe("ctrl+shift+p");
    expect(normalizeKeybinding("Shift+Alt+P")).toBe("alt+shift+p");
  });

  it("aliases Control → ctrl, Option → alt, Cmd/Command/Win/Super → meta", () => {
    expect(normalizeKeybinding("Control+S")).toBe("ctrl+s");
    expect(normalizeKeybinding("Option+F")).toBe("alt+f");
    expect(normalizeKeybinding("Cmd+S")).toBe("meta+s");
    expect(normalizeKeybinding("Command+S")).toBe("meta+s");
    expect(normalizeKeybinding("Win+S")).toBe("meta+s");
    expect(normalizeKeybinding("Super+S")).toBe("meta+s");
  });

  it("returns just sorted modifiers when there is no main key", () => {
    expect(normalizeKeybinding("Ctrl+Shift")).toBe("ctrl+shift");
  });

  it("preserves a single non-modifier key", () => {
    expect(normalizeKeybinding("Enter")).toBe("enter");
    expect(normalizeKeybinding("F12")).toBe("f12");
  });
});

describe("formatKeybindingForDisplay", () => {
  const origPlatform = navigator.platform;
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "platform", { value: origPlatform, configurable: true });
  });

  it("on non-Mac uses 'Ctrl', 'Shift', 'Alt', 'Win' and joins with '+'", () => {
    expect(formatKeybindingForDisplay("ctrl+shift+p")).toBe("Ctrl+Shift+P");
    expect(formatKeybindingForDisplay("alt+f4")).toBe("Alt+F4");
    expect(formatKeybindingForDisplay("meta+s")).toBe("Win+S");
  });

  it("on Mac uses platform glyphs and concatenates without separators", () => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    expect(formatKeybindingForDisplay("ctrl+p")).toBe("⌃P");
    expect(formatKeybindingForDisplay("shift+a")).toBe("⇧A");
    expect(formatKeybindingForDisplay("alt+f")).toBe("⌥F");
    expect(formatKeybindingForDisplay("meta+s")).toBe("⌘S");
    expect(formatKeybindingForDisplay("ctrl+shift+meta+p")).toBe("⌃⇧⌘P");
  });

  it("capitalizes single-char keys", () => {
    expect(formatKeybindingForDisplay("p")).toBe("P");
    expect(formatKeybindingForDisplay("enter")).toBe("Enter");
  });
});

function makeEvent(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: "",
    ...over,
  } as any;
}

describe("keyFromEvent", () => {
  it("encodes the modifier set in alphabetical order with the key appended", () => {
    expect(keyFromEvent(makeEvent({ ctrlKey: true, shiftKey: true, key: "P" }))).toBe("ctrl+shift+p");
    expect(keyFromEvent(makeEvent({ altKey: true, ctrlKey: true, key: "z" }))).toBe("alt+ctrl+z");
    expect(keyFromEvent(makeEvent({ metaKey: true, ctrlKey: true, shiftKey: true, altKey: true, key: "k" })))
      .toBe("alt+ctrl+meta+shift+k");
  });

  it("returns '' when the event key is a modifier-only press", () => {
    expect(keyFromEvent(makeEvent({ key: "Control", ctrlKey: true }))).toBe("");
    expect(keyFromEvent(makeEvent({ key: "Shift", shiftKey: true }))).toBe("");
    expect(keyFromEvent(makeEvent({ key: "Alt", altKey: true }))).toBe("");
    expect(keyFromEvent(makeEvent({ key: "Meta", metaKey: true }))).toBe("");
  });

  it("normalizes common physical-key names", () => {
    expect(keyFromEvent(makeEvent({ key: " " }))).toBe("space");
    expect(keyFromEvent(makeEvent({ key: "Escape" }))).toBe("escape");
    expect(keyFromEvent(makeEvent({ key: "Enter" }))).toBe("enter");
    expect(keyFromEvent(makeEvent({ key: "Tab" }))).toBe("tab");
    expect(keyFromEvent(makeEvent({ key: "Backspace" }))).toBe("backspace");
    expect(keyFromEvent(makeEvent({ key: "Delete" }))).toBe("delete");
    expect(keyFromEvent(makeEvent({ key: "ArrowUp" }))).toBe("up");
    expect(keyFromEvent(makeEvent({ key: "ArrowDown" }))).toBe("down");
    expect(keyFromEvent(makeEvent({ key: "ArrowLeft" }))).toBe("left");
    expect(keyFromEvent(makeEvent({ key: "ArrowRight" }))).toBe("right");
  });

  it("lowercases letter keys for a plain (no modifier) press", () => {
    expect(keyFromEvent(makeEvent({ key: "P" }))).toBe("p");
  });
});
