/** @vitest-environment jsdom */
/**
 * Pin tests for src/workbench/workbenchFileEditorSetup.ts.
 *
 * Pins:
 *   - exports initFileEditorSetup and findOpenEditorInput.
 *   - findOpenEditorInput walks every group.model.editors and returns the first
 *     editor whose uri.equals(target) is true, recognising FileEditorInput,
 *     ImageEditorInput, PdfEditorInput, EpubEditorInput.
 *   - findOpenEditorInput returns undefined when no match.
 *   - findOpenEditorInput ignores foreign editor types (Placeholder etc.).
 */
import { describe, it, expect, vi } from "vitest";

// Stub pdfjs-dist before any transitive import (pdfEditorPane → pdfViewerBootstrap → pdfjs-dist)
// reaches the browser-only DOMMatrix global that jsdom doesn't provide.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve({}) }),
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  PDFViewer: class { setDocument() {} currentScaleValue = "auto"; },
  PDFLinkService: class { setViewer() {} setDocument() {} },
  PDFFindController: class { setDocument() {} },
  EventBus: class { on() {} off() {} dispatch() {} },
}));
import {
  initFileEditorSetup,
  findOpenEditorInput,
} from "../../src/workbench/workbenchFileEditorSetup";
import { FileEditorInput } from "../../src/built-in/editor/fileEditorInput";
import { ImageEditorInput } from "../../src/built-in/editor/imageEditorInput";
import { PdfEditorInput } from "../../src/built-in/editor/pdfEditorInput";
import { EpubEditorInput } from "../../src/built-in/editor/epubEditorInput";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";
import { URI } from "../../src/platform/uri";

function fakeGroup(editors: any[]) {
  return { model: { editors } };
}
function fakeEditorPart(groups: any[]) {
  return { groups } as any;
}

describe("workbench/workbenchFileEditorSetup — exports", () => {
  it("exports initFileEditorSetup and findOpenEditorInput as functions", () => {
    expect(typeof initFileEditorSetup).toBe("function");
    expect(typeof findOpenEditorInput).toBe("function");
  });
});

describe("workbench/workbenchFileEditorSetup — findOpenEditorInput", () => {
  it("returns the matching FileEditorInput across groups", () => {
    const target = URI.file("C:/foo/a.txt");
    const a = FileEditorInput.create(target, undefined as any, undefined as any, undefined);
    const part = fakeEditorPart([fakeGroup([]), fakeGroup([a])]);
    expect(findOpenEditorInput(part, target)).toBe(a);
  });

  it("returns the matching ImageEditorInput", () => {
    const target = URI.file("C:/img.png");
    const img = ImageEditorInput.create(target);
    expect(findOpenEditorInput(fakeEditorPart([fakeGroup([img])]), target)).toBe(img);
  });

  it("returns the matching PdfEditorInput", () => {
    const target = URI.file("C:/doc.pdf");
    const pdf = PdfEditorInput.create(target);
    expect(findOpenEditorInput(fakeEditorPart([fakeGroup([pdf])]), target)).toBe(pdf);
  });

  it("returns the matching EpubEditorInput", () => {
    const target = URI.file("C:/book.epub");
    const epub = EpubEditorInput.create(target);
    expect(findOpenEditorInput(fakeEditorPart([fakeGroup([epub])]), target)).toBe(epub);
  });

  it("returns undefined when nothing matches", () => {
    const target = URI.file("C:/missing.txt");
    const other = FileEditorInput.create(URI.file("C:/other.txt"), undefined as any, undefined as any, undefined);
    expect(findOpenEditorInput(fakeEditorPart([fakeGroup([other])]), target)).toBeUndefined();
  });

  it("ignores non-file editor types (PlaceholderEditorInput)", () => {
    const target = URI.file("C:/x.txt");
    const placeholder = new PlaceholderEditorInput("p");
    expect(findOpenEditorInput(fakeEditorPart([fakeGroup([placeholder])]), target)).toBeUndefined();
  });
});
