/**
 * @vitest-environment jsdom
 *
 * Pin: canvasIcons — ICON_IDS / PAGE_ICON_IDS contracts, ALL_PAGE_ICON_IDS
 * delegation to central registry, svgIcon fallback, createIconElement size,
 * resolvePageIcon emoji/null/unknown→'page'.
 */
import { describe, it, expect } from "vitest";
import {
  ICON_IDS,
  PAGE_ICON_IDS,
  ALL_PAGE_ICON_IDS,
  svgIcon,
  createIconElement,
  resolvePageIcon,
} from "../../src/built-in/canvas/canvasIcons";
import { getAllLucideIconIds } from "../../src/ui/iconRegistry";

describe("built-in/canvas/canvasIcons", () => {
  it("ICON_IDS includes the navigation primitives that the canvas surface depends on", () => {
    // Pinned subset — any reorg that drops one of these silently breaks the
    // canvas chrome (chevrons, plus-button, page icon, etc).
    for (const k of [
      "page", "page-filled", "folder", "chevron-right", "plus",
      "trash", "close", "edit", "search", "image", "link",
      "view-table", "view-board", "view-list", "view-gallery",
      "view-calendar", "view-timeline", "database", "toc",
      "bullet-list", "numbered-list", "quote", "divider", "columns",
      "format-bold", "format-italic", "format-underline", "format-strikethrough",
      "align-left", "align-center", "align-right",
    ]) {
      expect(ICON_IDS).toContain(k);
    }
  });

  it("PAGE_ICON_IDS is a curated subset of the broader Lucide catalog", () => {
    expect(PAGE_ICON_IDS).toContain("page");
    expect(PAGE_ICON_IDS).toContain("note");
    expect(PAGE_ICON_IDS).toContain("bookmark");
    // No format-* (those are bubble-menu only).
    expect(PAGE_ICON_IDS.every(id => !id.startsWith("format-"))).toBe(true);
  });

  it("ALL_PAGE_ICON_IDS delegates 1:1 to getAllLucideIconIds()", () => {
    const fromRegistry = getAllLucideIconIds();
    expect(ALL_PAGE_ICON_IDS).toEqual(fromRegistry);
  });

  it("svgIcon returns the SVG string for a known id", () => {
    const s = svgIcon("page");
    expect(typeof s).toBe("string");
    expect(s).toMatch(/<svg[\s>]/);
  });

  it("svgIcon falls back to the 'page' icon for an unknown id", () => {
    const unknown = svgIcon("definitely-not-an-icon-xyz");
    const pageIcon = svgIcon("page");
    expect(unknown).toBe(pageIcon);
  });

  it("createIconElement returns an inline-flex span carrying an <svg> with the requested size", () => {
    const el = createIconElement("page", 24);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("canvas-svg-icon");
    expect(el.style.width).toBe("24px");
    expect(el.style.height).toBe("24px");
    const svg = el.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
  });

  it("createIconElement default size is 16px", () => {
    const el = createIconElement("page");
    expect(el.style.width).toBe("16px");
    expect(el.style.height).toBe("16px");
  });

  it("resolvePageIcon: null / undefined / '' → 'page'", () => {
    expect(resolvePageIcon(null)).toBe("page");
    expect(resolvePageIcon(undefined)).toBe("page");
    expect(resolvePageIcon("")).toBe("page");
  });

  it("resolvePageIcon: legacy emoji input falls back to 'page'", () => {
    // Emojis are not registered icon ids — must NOT pass through.
    expect(resolvePageIcon("📄")).toBe("page");
    expect(resolvePageIcon("⭐")).toBe("page");
  });

  it("resolvePageIcon: known id passes through unchanged", () => {
    expect(resolvePageIcon("bookmark")).toBe("bookmark");
    expect(resolvePageIcon("note")).toBe("note");
  });

  it("resolvePageIcon: unknown string falls back to 'page'", () => {
    expect(resolvePageIcon("not-a-real-icon")).toBe("page");
  });
});
