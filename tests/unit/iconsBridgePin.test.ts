// iconsBridgePin.test.ts — pin the `parallx.icons` bridge surface.

import { describe, it, expect } from "vitest";
import { IconsBridge } from "../../src/api/bridges/iconsBridge";
import { LUCIDE_ICONS } from "../../src/ui/iconRegistry.generated";
import { FILE_TYPE_ICONS } from "../../src/ui/fileTypeIcons";

describe("IconsBridge", () => {
  it("getIcon returns the registered SVG for a known id", () => {
    const b = new IconsBridge();
    const svg = b.getIcon("activity");
    expect(svg).toBe(LUCIDE_ICONS["activity"]);
  });

  it("getIcon returns empty string for unknown id", () => {
    const b = new IconsBridge();
    expect(b.getIcon("definitely-not-an-icon-xyz")).toBe("");
  });

  it("hasIcon returns true for a Lucide id and false for unknowns", () => {
    const b = new IconsBridge();
    expect(b.hasIcon("activity")).toBe(true);
    expect(b.hasIcon("nope-nope-nope")).toBe(false);
  });

  it("getAllIconIds returns the union of Lucide + file-type ids and is cached", () => {
    const b = new IconsBridge();
    const first = b.getAllIconIds();
    const expectedSize = Object.keys(LUCIDE_ICONS).length + Object.keys(FILE_TYPE_ICONS).length;
    expect(first.length).toBe(expectedSize);
    expect(first.includes("activity")).toBe(true);
    expect(first.includes("filetype-pdf")).toBe(true);
    const second = b.getAllIconIds();
    // identity equality — cached reference
    expect(second).toBe(first);
  });

  it("createIconHtml injects width/height into the <svg> and wraps in svg-icon span", () => {
    const b = new IconsBridge();
    const html = b.createIconHtml("activity", 24);
    expect(html.startsWith("<span")).toBe(true);
    expect(html.includes('class="svg-icon"')).toBe(true);
    expect(html.includes("width:24px")).toBe(true);
    expect(html.includes("height:24px")).toBe(true);
    expect(html.includes('width="24" height="24"')).toBe(true);
    expect(html.endsWith("</span>")).toBe(true);
  });

  it("createIconHtml defaults to size 16", () => {
    const b = new IconsBridge();
    const html = b.createIconHtml("activity");
    expect(html.includes("width:16px")).toBe(true);
    expect(html.includes('width="16" height="16"')).toBe(true);
  });

  it("createIconHtml returns empty string for unknown id", () => {
    const b = new IconsBridge();
    expect(b.createIconHtml("unknown-xyz")).toBe("");
  });

  it("getFileTypeIcon returns the SVG for a known extension", () => {
    const b = new IconsBridge();
    const svg = b.getFileTypeIcon("pdf");
    expect(svg).toBe(FILE_TYPE_ICONS["filetype-pdf"]);
  });
});
