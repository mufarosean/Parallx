/**
 * Pin-the-invariant: binary/preview editor inputs — ImageEditorInput, PdfEditorInput,
 * EpubEditorInput, SettingsEditorInput, MarkdownPreviewInput.
 */
import { describe, it, expect, vi } from "vitest";
import { ImageEditorInput } from "../../src/built-in/editor/imageEditorInput";
import { PdfEditorInput } from "../../src/built-in/editor/pdfEditorInput";
import { EpubEditorInput } from "../../src/built-in/editor/epubEditorInput";
import { SettingsEditorInput } from "../../src/built-in/editor/settingsEditorInput";
import { MarkdownPreviewInput } from "../../src/built-in/editor/markdownPreviewInput";
import { URI } from "../../src/platform/uri";

describe("ImageEditorInput", () => {
  it("pins basic identity invariants", () => {
    const a = ImageEditorInput.create(URI.file("/tmp/x.png"));
    expect(a.typeId).toBe("parallx.editor.image");
    expect(a.name).toBe("x.png");
    expect(a.isDirty).toBe(false);
  });

  it("matches() compares URIs", () => {
    const a = ImageEditorInput.create(URI.file("/tmp/x.png"));
    const b = ImageEditorInput.create(URI.file("/tmp/x.png"));
    const c = ImageEditorInput.create(URI.file("/tmp/y.png"));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
  });

  it("serialize() emits uri + non-pinned", () => {
    const uri = URI.file("/tmp/x.png");
    const s = ImageEditorInput.create(uri).serialize();
    expect(s.pinned).toBe(false);
    expect(s.data).toEqual({ uri: uri.toString() });
  });
});

describe("PdfEditorInput", () => {
  it("create() defaults page=1 and undefined scaleValue", () => {
    const a = PdfEditorInput.create(URI.file("/tmp/x.pdf"));
    expect(a.typeId).toBe("parallx.editor.pdf");
    expect(a.page).toBe(1);
    expect(a.scaleValue).toBeUndefined();
  });

  it("create() carries page + scaleValue through serialize()", () => {
    const uri = URI.file("/tmp/x.pdf");
    const a = PdfEditorInput.create(uri, 5, "page-fit");
    const s = a.serialize();
    expect(s.data).toEqual({ uri: uri.toString(), page: 5, scaleValue: "page-fit" });
  });

  it("matches() by URI", () => {
    const a = PdfEditorInput.create(URI.file("/tmp/a.pdf"));
    const b = PdfEditorInput.create(URI.file("/tmp/a.pdf"));
    expect(a.matches(b)).toBe(true);
  });
});

describe("EpubEditorInput", () => {
  it("defaults scrollTop=0 and fontScale=1", () => {
    const a = EpubEditorInput.create(URI.file("/tmp/x.epub"));
    expect(a.typeId).toBe("parallx.editor.epub");
    expect(a.scrollTop).toBe(0);
    expect(a.fontScale).toBe(1);
  });

  it("serialize() carries scrollTop + fontScale", () => {
    const uri = URI.file("/tmp/x.epub");
    const s = EpubEditorInput.create(uri, 240, 1.25).serialize();
    expect(s.data).toEqual({ uri: uri.toString(), scrollTop: 240, fontScale: 1.25 });
  });

  it("matches() by URI", () => {
    const a = EpubEditorInput.create(URI.file("/tmp/a.epub"));
    const b = EpubEditorInput.create(URI.file("/tmp/a.epub"));
    expect(a.matches(b)).toBe(true);
  });
});

describe("SettingsEditorInput", () => {
  it("singleton across calls, recreates after dispose", () => {
    const a = SettingsEditorInput.getInstance();
    expect(a.typeId).toBe("parallx.editor.settings");
    expect(a.name).toBe("Settings");
    const b = SettingsEditorInput.getInstance();
    expect(b).toBe(a);
    a.dispose();
    const c = SettingsEditorInput.getInstance();
    expect(c).not.toBe(a);
  });

  it("matches() any SettingsEditorInput instance", () => {
    const a = SettingsEditorInput.getInstance();
    expect(a.matches(a)).toBe(true);
    expect(a.matches({ typeId: "x", id: "y" } as any)).toBe(false);
  });
});

describe("MarkdownPreviewInput", () => {
  function makeSource(uri = URI.file("/tmp/r.md")) {
    return {
      uri,
      name: uri.basename,
      description: uri.fsPath,
      content: "BODY",
      onDidChangeContent: () => ({ dispose() {} }),
      resolve: vi.fn().mockResolvedValue({}),
    } as any;
  }

  it("create() name prefixed with 'Preview ' and is read-only", () => {
    const src = makeSource();
    const a = MarkdownPreviewInput.create(src);
    expect(a.typeId).toBe("parallx.editor.markdownPreview");
    expect(a.name).toBe("Preview r.md");
    expect(a.isDirty).toBe(false);
  });

  it("delegates uri/description/content to source", () => {
    const src = makeSource(URI.file("/tmp/foo.md"));
    const a = MarkdownPreviewInput.create(src);
    expect(a.uri.equals(src.uri)).toBe(true);
    expect(a.description).toBe(src.description);
    expect(a.content).toBe("BODY");
    expect(a.sourceInput).toBe(src);
  });

  it("resolve() forwards to source.resolve()", async () => {
    const src = makeSource();
    const a = MarkdownPreviewInput.create(src);
    await a.resolve();
    expect(src.resolve).toHaveBeenCalled();
  });

  it("matches() compares source URIs", () => {
    const a = MarkdownPreviewInput.create(makeSource(URI.file("/tmp/a.md")));
    const b = MarkdownPreviewInput.create(makeSource(URI.file("/tmp/a.md")));
    const c = MarkdownPreviewInput.create(makeSource(URI.file("/tmp/c.md")));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
  });

  it("serialize() emits pinned=true + uri", () => {
    const src = makeSource();
    const s = MarkdownPreviewInput.create(src).serialize();
    expect(s.pinned).toBe(true);
    expect(s.data).toEqual({ uri: src.uri.toString() });
  });
});
