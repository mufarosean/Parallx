/**
 * Pin: imagePathResolver — pure path-classification helpers shared between
 * canvas image insertion paths.  Covers looksLikeLocalPath, fileUrlToPath,
 * hasImageExtension, and the readLocalImageAsDataUrl IPC error matrix.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  looksLikeLocalPath,
  fileUrlToPath,
  hasImageExtension,
  readLocalImageAsDataUrl,
} from "../../src/built-in/canvas/menus/imagePathResolver";

describe("looksLikeLocalPath — local FS / file:// detection", () => {
  it("matches Windows drive letters (C:/, D:\\)", () => {
    expect(looksLikeLocalPath("C:/Users/x.png")).toBe(true);
    expect(looksLikeLocalPath("D:\\images\\a.jpg")).toBe(true);
  });

  it("matches POSIX absolute paths", () => {
    expect(looksLikeLocalPath("/var/x.png")).toBe(true);
    expect(looksLikeLocalPath("\\\\unc\\share\\x.png")).toBe(true);
  });

  it("matches file:// URLs", () => {
    expect(looksLikeLocalPath("file:///C:/x.png")).toBe(true);
  });

  it("rejects http(s):// and bare names", () => {
    expect(looksLikeLocalPath("https://example.com/x.png")).toBe(false);
    expect(looksLikeLocalPath("http://x")).toBe(false);
    expect(looksLikeLocalPath("relative.png")).toBe(false);
    expect(looksLikeLocalPath("")).toBe(false);
  });
});

describe("fileUrlToPath — strip file:// and decode escapes", () => {
  it("strips file:/// for Windows-style paths and decodes %20", () => {
    expect(fileUrlToPath("file:///C:/My%20Folder/a.png")).toBe("C:/My Folder/a.png");
  });

  it("strips file:// (host-relative form) and decodes", () => {
    expect(fileUrlToPath("file://server/share/x%20y.png")).toBe("server/share/x y.png");
  });

  it("ensures POSIX leading slash when file:/// resolves to non-drive", () => {
    expect(fileUrlToPath("file:///var/foo.png")).toBe("/var/foo.png");
  });

  it("returns input unchanged when not a file URL", () => {
    expect(fileUrlToPath("D:/x/y.png")).toBe("D:/x/y.png");
  });

  it("keeps raw text when decodeURIComponent throws", () => {
    // %ZZ is invalid percent-encoding — decode throws and we keep raw
    expect(fileUrlToPath("file:///C:/bad%ZZ.png")).toBe("C:/bad%ZZ.png");
  });
});

describe("hasImageExtension — case-insensitive whitelist", () => {
  it.each([
    "png", "PNG", "Jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
  ])("accepts .%s", (ext) => {
    expect(hasImageExtension(`/x/y.${ext}`)).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    expect(hasImageExtension("/x/y.tiff")).toBe(false);
    expect(hasImageExtension("/x/y.txt")).toBe(false);
  });

  it("strips query and hash before matching", () => {
    expect(hasImageExtension("https://x/y.png?cb=1")).toBe(true);
    expect(hasImageExtension("https://x/y.png#frag")).toBe(true);
  });

  it("returns false when no extension is present", () => {
    expect(hasImageExtension("/x/y")).toBe(false);
  });
});

describe("readLocalImageAsDataUrl — IPC error matrix", () => {
  let origElectron: any;
  beforeEach(() => {
    origElectron = (globalThis as any).window;
    (globalThis as any).window = {};
  });
  afterEach(() => {
    (globalThis as any).window = origElectron;
  });

  it("returns 'Local files unavailable' when no IPC bridge", async () => {
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toMatch(/Local files unavailable/);
  });

  it("returns 'Unsupported image format' for non-image extensions", async () => {
    (globalThis as any).window.parallxElectron = { fs: { readFile: async () => ({}) } };
    const res = await readLocalImageAsDataUrl("C:/x.txt");
    expect(res.error).toBe("Unsupported image format.");
  });

  it("propagates fs error.message via 'Could not read file'", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({ error: { message: "ENOENT" } }) },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("Could not read file: ENOENT");
  });

  it("propagates fs error.code when no message", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({ error: { code: "EACCES" } }) },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("Could not read file: EACCES");
  });

  it("returns 'File is empty or unreadable' when no content", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({}) },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("File is empty or unreadable.");
  });

  it("rejects non-base64 encoding (not a recognized binary)", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({ content: "hello", encoding: "utf8" }) },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("File is not a recognized binary image.");
  });

  it("rejects oversize images (> 5 MB raw)", async () => {
    const big = "A".repeat(Math.floor(5 * 1024 * 1024 * 1.37) + 1);
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({ content: big, encoding: "base64" }) },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("Image is too large (max 5 MB).");
  });

  it("returns data:image/<mime>;base64,<content> on success", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => ({ content: "AAAA", encoding: "base64" }) },
    };
    const png = await readLocalImageAsDataUrl("C:/x.PNG");
    expect(png.dataUrl).toBe("data:image/png;base64,AAAA");
    const jpg = await readLocalImageAsDataUrl("C:/x.jpg");
    expect(jpg.dataUrl).toBe("data:image/jpeg;base64,AAAA");
    const svg = await readLocalImageAsDataUrl("C:/x.svg");
    expect(svg.dataUrl).toBe("data:image/svg+xml;base64,AAAA");
  });

  it("catches thrown errors and returns 'Read failed: <message>'", async () => {
    (globalThis as any).window.parallxElectron = {
      fs: { readFile: async () => { throw new Error("boom"); } },
    };
    const res = await readLocalImageAsDataUrl("C:/x.png");
    expect(res.error).toBe("Read failed: boom");
  });
});
