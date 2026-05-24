/** @vitest-environment jsdom */
/**
 * Pin tests for ui/iconRegistry — invariant guards.
 *
 * Pins the public API surface:
 *   - registerIcon/getIcon/hasIcon round-trip
 *   - getIcon returns '' for unknown ids (never undefined/null)
 *   - getFileTypeIcon strips leading dot, lowercases, falls back to 'file'
 *   - getFolderIcon prefers filetype-folder, falls back to folder
 *   - getPageIcon returns the registered 'page' icon
 *   - getAvatarIcon by id; AVATAR_ICON_IDS has exactly 12 entries
 *   - createIconElement sets width/height/CSS and resizes inner SVG
 *   - getAllLucideIconIds is non-empty and excludes synthetic file-type ids
 */
import { describe, it, expect } from "vitest";
import {
  registerIcon,
  getIcon,
  hasIcon,
  getFileTypeIcon,
  getFolderIcon,
  getPageIcon,
  getAvatarIcon,
  AVATAR_ICON_IDS,
  createIconElement,
  getAllLucideIconIds,
} from "../../src/ui/iconRegistry";

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';

describe("iconRegistry — register/get/has round-trip", () => {
  it("registerIcon then getIcon returns the exact SVG", () => {
    registerIcon("pin-test-icon-A", SAMPLE_SVG);
    expect(getIcon("pin-test-icon-A")).toBe(SAMPLE_SVG);
  });

  it("hasIcon reflects registration state", () => {
    registerIcon("pin-test-icon-B", SAMPLE_SVG);
    expect(hasIcon("pin-test-icon-B")).toBe(true);
    expect(hasIcon("pin-test-icon-nonexistent-xyz")).toBe(false);
  });

  it("getIcon returns empty string (not undefined) for unknown ids", () => {
    const v = getIcon("definitely-not-a-real-icon-id-zzz");
    expect(v).toBe("");
    expect(typeof v).toBe("string");
  });

  it("registerIcon overwrites a previous registration", () => {
    registerIcon("pin-test-icon-C", SAMPLE_SVG);
    const replacement = '<svg id="replaced"/>';
    registerIcon("pin-test-icon-C", replacement);
    expect(getIcon("pin-test-icon-C")).toBe(replacement);
  });
});

describe("iconRegistry — file-type helpers", () => {
  it("getFileTypeIcon handles a leading dot in the extension", () => {
    const withDot = getFileTypeIcon(".ts");
    const without = getFileTypeIcon("ts");
    expect(withDot).toBe(without);
    expect(withDot.length).toBeGreaterThan(0);
  });

  it("getFileTypeIcon is case-insensitive", () => {
    expect(getFileTypeIcon("TS")).toBe(getFileTypeIcon("ts"));
  });

  it("getFileTypeIcon falls back to the generic 'file' icon for unknown extensions", () => {
    const unknown = getFileTypeIcon("a-totally-made-up-extension-xyz");
    const generic = getIcon("file");
    expect(unknown).toBe(generic);
  });

  it("getFolderIcon returns a non-empty SVG string", () => {
    const v = getFolderIcon();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("getPageIcon returns the registered 'page' icon (may be empty if not registered)", () => {
    expect(getPageIcon()).toBe(getIcon("page"));
  });
});

describe("iconRegistry — avatar API", () => {
  it("AVATAR_ICON_IDS lists exactly 12 ids", () => {
    expect(AVATAR_ICON_IDS.length).toBe(12);
  });

  it("every avatar id starts with 'avatar-'", () => {
    for (const id of AVATAR_ICON_IDS) {
      expect(id.startsWith("avatar-")).toBe(true);
    }
  });

  it("getAvatarIcon returns the registered SVG for a known avatar id", () => {
    // Use the first id; the registry seeds these from Lucide.
    const id = AVATAR_ICON_IDS[0];
    expect(getAvatarIcon(id)).toBe(getIcon(id));
  });

  it("getAvatarIcon returns '' for an unknown avatar id", () => {
    expect(getAvatarIcon("avatar-not-real-zzz")).toBe("");
  });
});

describe("iconRegistry — createIconElement", () => {
  it("creates a span.svg-icon with size styles applied", () => {
    registerIcon("pin-test-icon-CIE", SAMPLE_SVG);
    const el = createIconElement("pin-test-icon-CIE", 20);
    expect(el.tagName.toLowerCase()).toBe("span");
    expect(el.classList.contains("svg-icon")).toBe(true);
    expect(el.style.width).toBe("20px");
    expect(el.style.height).toBe("20px");
    expect(el.style.display).toBe("inline-flex");
    expect(el.style.flexShrink).toBe("0");
  });

  it("propagates size to the inner SVG width/height attributes", () => {
    registerIcon("pin-test-icon-CIE2", SAMPLE_SVG);
    const el = createIconElement("pin-test-icon-CIE2", 24);
    const svg = el.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("width")).toBe("24");
    expect(svg!.getAttribute("height")).toBe("24");
  });

  it("defaults to size 16 when no size argument is given", () => {
    registerIcon("pin-test-icon-CIE3", SAMPLE_SVG);
    const el = createIconElement("pin-test-icon-CIE3");
    expect(el.style.width).toBe("16px");
    const svg = el.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("16");
  });

  it("produces a span with empty innerHTML when icon id is unknown (no throw)", () => {
    const el = createIconElement("not-real-icon-zzz", 16);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.innerHTML).toBe("");
  });
});

describe("iconRegistry — getAllLucideIconIds", () => {
  it("returns a non-empty array of strings", () => {
    const ids = getAllLucideIconIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(typeof ids[0]).toBe("string");
  });

  it("does NOT include synthetic 'filetype-*' ids", () => {
    const ids = getAllLucideIconIds();
    const anyFiletype = ids.some((id) => id.startsWith("filetype-"));
    expect(anyFiletype).toBe(false);
  });
});
