// fileTypeIconsPin.test.ts — pin file type icon constants.

import { describe, it, expect } from "vitest";
import { FILE_TYPE_ICONS, FILE_TYPE_MAP } from "../../src/ui/fileTypeIcons";

describe("FILE_TYPE_ICONS", () => {
  it("every entry is a non-empty SVG string", () => {
    const keys = Object.keys(FILE_TYPE_ICONS);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const v = FILE_TYPE_ICONS[k];
      expect(typeof v).toBe("string");
      expect(v.startsWith("<svg")).toBe(true);
      expect(v.includes("viewBox=\"0 0 24 24\"")).toBe(true);
      expect(v.endsWith("</svg>")).toBe(true);
    }
  });

  it("every icon id is prefixed with 'filetype-'", () => {
    for (const k of Object.keys(FILE_TYPE_ICONS)) {
      expect(k.startsWith("filetype-")).toBe(true);
    }
  });

  it("includes the canonical document, media, and code families", () => {
    for (const k of [
      "filetype-pdf", "filetype-doc", "filetype-xlsx", "filetype-pptx",
      "filetype-image", "filetype-video", "filetype-audio", "filetype-archive",
    ]) {
      expect(FILE_TYPE_ICONS[k]).toBeTruthy();
    }
  });
});

describe("FILE_TYPE_MAP", () => {
  it("every value is an id that exists in FILE_TYPE_ICONS", () => {
    for (const [ext, id] of Object.entries(FILE_TYPE_MAP)) {
      expect(FILE_TYPE_ICONS[id], `${ext} → ${id}`).toBeTruthy();
    }
  });

  it("keys are lowercase, no leading dot", () => {
    for (const k of Object.keys(FILE_TYPE_MAP)) {
      expect(k).toBe(k.toLowerCase());
      expect(k.startsWith(".")).toBe(false);
    }
  });

  it("maps canonical extensions to the expected icon families", () => {
    expect(FILE_TYPE_MAP.pdf).toBe("filetype-pdf");
    expect(FILE_TYPE_MAP.md).toBe("filetype-md");
    expect(FILE_TYPE_MAP.markdown).toBe("filetype-md");
    expect(FILE_TYPE_MAP.xlsx).toBe("filetype-xlsx");
    expect(FILE_TYPE_MAP.pptx).toBe("filetype-pptx");
    expect(FILE_TYPE_MAP.jpg).toBe("filetype-image");
    expect(FILE_TYPE_MAP.png).toBe("filetype-image");
    expect(FILE_TYPE_MAP.mp4).toBe("filetype-video");
    expect(FILE_TYPE_MAP.mp3).toBe("filetype-audio");
    expect(FILE_TYPE_MAP.zip).toBe("filetype-archive");
  });

  it("aliases multiple image extensions to filetype-image", () => {
    for (const e of ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "avif"]) {
      expect(FILE_TYPE_MAP[e]).toBe("filetype-image");
    }
  });

  it("aliases multiple video extensions to filetype-video", () => {
    for (const e of ["mp4", "mov", "mkv", "webm", "avi"]) {
      expect(FILE_TYPE_MAP[e]).toBe("filetype-video");
    }
  });

  it("typescript family extensions map to filetype-ts/tsx", () => {
    expect(FILE_TYPE_MAP.ts).toBe("filetype-ts");
    expect(FILE_TYPE_MAP.mts).toBe("filetype-ts");
    expect(FILE_TYPE_MAP.cts).toBe("filetype-ts");
    expect(FILE_TYPE_MAP.tsx).toBe("filetype-tsx");
  });
});
