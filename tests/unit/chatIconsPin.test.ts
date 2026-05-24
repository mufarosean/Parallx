/**
 * Pin: chatIcons — every named chat-icon key resolves to a non-empty SVG
 * string from the central iconRegistry, and the full key set is the user-
 * visible icon contract for the chat surface.
 */
import { describe, it, expect } from "vitest";
import { chatIcons } from "../../src/built-in/chat/chatIcons";

const EXPECTED_KEYS = [
  "newChat", "history", "refresh", "search", "gear", "scrollText",
  "send", "stop", "attach",
  "chevronDown",
  "sparkle", "chatBubble", "pencil", "agent", "atSign", "canvas",
  "keyboard", "wand", "lightbulb",
  "chevronRight", "sectionExpanded", "trash",
  "copy", "check", "wrench", "tools", "person", "sparkleSmall",
  "file", "close", "folder", "image", "selection",
] as const;

describe("built-in/chat/chatIcons — registry contract", () => {
  it("exposes exactly the expected named keys", () => {
    expect(Object.keys(chatIcons).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("every value is a non-empty <svg> string", () => {
    for (const key of EXPECTED_KEYS) {
      const v = (chatIcons as any)[key];
      expect(typeof v, key).toBe("string");
      expect(v.length, key).toBeGreaterThan(0);
      expect(v, key).toMatch(/<svg[\s>]/);
    }
  });

  it("close, send, and trash are distinct icons (no accidental aliasing)", () => {
    expect(chatIcons.close).not.toBe(chatIcons.send);
    expect(chatIcons.trash).not.toBe(chatIcons.close);
    expect(chatIcons.send).not.toBe(chatIcons.stop);
  });
});
