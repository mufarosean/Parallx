/**
 * Pin: EpubEditorInput + PdfEditorInput — lightweight URI holders for the
 * EPUB and PDF editor panes.  Locks TYPE_IDs, factory defaults, dedupe by
 * URI key, matches() instanceof+URI equality, serialize() shape, and the
 * mutable view-state fields (scrollTop/fontScale for EPUB, page/scaleValue
 * for PDF).
 */
import { describe, it, expect } from "vitest";
import { EpubEditorInput } from "../../src/built-in/editor/epubEditorInput";
import { PdfEditorInput } from "../../src/built-in/editor/pdfEditorInput";
import { URI } from "../../src/platform/uri";

describe("EpubEditorInput", () => {
  const uri = URI.file("D:/lib/book.epub");

  it("TYPE_ID is 'parallx.editor.epub'", () => {
    expect(EpubEditorInput.TYPE_ID).toBe("parallx.editor.epub");
  });

  it("create() defaults: scrollTop=0, fontScale=1", () => {
    const input = EpubEditorInput.create(uri);
    expect(input.scrollTop).toBe(0);
    expect(input.fontScale).toBe(1);
  });

  it("create() forwards optional scrollTop and fontScale", () => {
    const input = EpubEditorInput.create(uri, 1200, 1.5);
    expect(input.scrollTop).toBe(1200);
    expect(input.fontScale).toBe(1.5);
  });

  it("id derives from uri.toKey() so same URI dedupes by identity", () => {
    const a = EpubEditorInput.create(uri);
    const b = EpubEditorInput.create(URI.file("D:/lib/book.epub"));
    expect(a.id).toBe(b.id);
  });

  it("name=basename, description=fsPath, typeId=TYPE_ID, isDirty=false", () => {
    const input = EpubEditorInput.create(uri);
    expect(input.name).toBe("book.epub");
    expect(input.description).toBe(uri.fsPath);
    expect(input.typeId).toBe("parallx.editor.epub");
    expect(input.isDirty).toBe(false);
    expect(input.uri).toBe(uri);
  });

  it("matches() requires instanceof EpubEditorInput AND URI equality", () => {
    const a = EpubEditorInput.create(URI.file("D:/lib/book.epub"));
    const b = EpubEditorInput.create(URI.file("D:/lib/book.epub"));
    const c = EpubEditorInput.create(URI.file("D:/lib/other.epub"));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
    expect(a.matches({ id: a.id } as any)).toBe(false);
  });

  it("serialize() yields {inputId, typeId, name, description, pinned:false, sticky:false, data:{uri,scrollTop,fontScale}}", () => {
    const input = EpubEditorInput.create(uri, 800, 1.25);
    expect(input.serialize()).toEqual({
      inputId: input.id,
      typeId: "parallx.editor.epub",
      name: "book.epub",
      description: uri.fsPath,
      pinned: false,
      sticky: false,
      data: {
        uri: uri.toString(),
        scrollTop: 800,
        fontScale: 1.25,
      },
    });
  });
});

describe("PdfEditorInput", () => {
  const uri = URI.file("D:/docs/spec.pdf");

  it("TYPE_ID is 'parallx.editor.pdf'", () => {
    expect(PdfEditorInput.TYPE_ID).toBe("parallx.editor.pdf");
  });

  it("create() defaults: page=1, scaleValue=undefined", () => {
    const input = PdfEditorInput.create(uri);
    expect(input.page).toBe(1);
    expect(input.scaleValue).toBeUndefined();
  });

  it("create() forwards optional page and scaleValue", () => {
    const input = PdfEditorInput.create(uri, 17, "page-width");
    expect(input.page).toBe(17);
    expect(input.scaleValue).toBe("page-width");
  });

  it("id derives from uri.toKey() so same URI dedupes by identity", () => {
    const a = PdfEditorInput.create(uri);
    const b = PdfEditorInput.create(URI.file("D:/docs/spec.pdf"));
    expect(a.id).toBe(b.id);
  });

  it("name=basename, description=fsPath, typeId=TYPE_ID, isDirty=false", () => {
    const input = PdfEditorInput.create(uri);
    expect(input.name).toBe("spec.pdf");
    expect(input.description).toBe(uri.fsPath);
    expect(input.typeId).toBe("parallx.editor.pdf");
    expect(input.isDirty).toBe(false);
    expect(input.uri).toBe(uri);
  });

  it("matches() requires instanceof PdfEditorInput AND URI equality", () => {
    const a = PdfEditorInput.create(URI.file("D:/docs/spec.pdf"));
    const b = PdfEditorInput.create(URI.file("D:/docs/spec.pdf"));
    const c = PdfEditorInput.create(URI.file("D:/docs/other.pdf"));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
    expect(a.matches({ id: a.id } as any)).toBe(false);
    // EpubEditorInput shape but PdfEditorInput consumer
    expect(a.matches(EpubEditorInput.create(URI.file("D:/docs/spec.pdf")) as any)).toBe(false);
  });

  it("serialize() yields {inputId, typeId, name, description, pinned:false, sticky:false, data:{uri,page,scaleValue}}", () => {
    const input = PdfEditorInput.create(uri, 9, "fit-page");
    expect(input.serialize()).toEqual({
      inputId: input.id,
      typeId: "parallx.editor.pdf",
      name: "spec.pdf",
      description: uri.fsPath,
      pinned: false,
      sticky: false,
      data: {
        uri: uri.toString(),
        page: 9,
        scaleValue: "fit-page",
      },
    });
  });

  it("serialize() includes scaleValue=undefined when never set", () => {
    const input = PdfEditorInput.create(uri);
    const ser = input.serialize();
    expect((ser.data as any).page).toBe(1);
    expect((ser.data as any).scaleValue).toBeUndefined();
  });
});
