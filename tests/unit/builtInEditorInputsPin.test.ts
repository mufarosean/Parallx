/** @vitest-environment jsdom */
/**
 * Pin tests for built-in editor inputs that are pure data holders:
 *   - src/built-in/editor/pdfEditorInput.ts
 *   - src/built-in/editor/epubEditorInput.ts
 *   - src/built-in/editor/readonlyMarkdownInput.ts
 *   - src/built-in/editor/markdownPreviewInput.ts
 *
 * Pins:
 *   - PdfEditorInput.create(uri, page, scaleValue) records all three; name=basename,
 *     description=fsPath; typeId='parallx.editor.pdf'; isDirty=false.
 *     matches() returns true only for another PdfEditorInput with equal URI.
 *     serialize() returns { typeId, name, description, pinned:false, sticky:false,
 *     data: { uri, page, scaleValue } }.
 *   - EpubEditorInput mirrors PDF but stores { scrollTop, fontScale }.
 *   - ReadonlyMarkdownInput: id=`readonly-md-N`; uri=`parallx-readonly-md://<id>`;
 *     isDirty=false; updateContent() fires onDidChangeContent only when value differs;
 *     save() resolves to undefined; revert() resolves; confirmClose() resolves true;
 *     serialize.data = { content }.
 *   - MarkdownPreviewInput.create(src) builds id=`${src.uri.toKey()}#preview`,
 *     name=`Preview <src.name>`, isDirty=false, forwards .content / .onDidChangeContent /
 *     .resolve() to source; matches() true only for another MarkdownPreviewInput with
 *     equal source URI; serialize.data = { uri: src.uri.toString() }, pinned=true.
 */
import { describe, it, expect, vi } from "vitest";
import { PdfEditorInput } from "../../src/built-in/editor/pdfEditorInput";
import { EpubEditorInput } from "../../src/built-in/editor/epubEditorInput";
import { ReadonlyMarkdownInput } from "../../src/built-in/editor/readonlyMarkdownInput";
import { MarkdownPreviewInput } from "../../src/built-in/editor/markdownPreviewInput";
import { URI } from "../../src/platform/uri";

describe("built-in/editor — PdfEditorInput", () => {
  it("create() records uri/page/scaleValue and pins typeId/name/description", () => {
    const uri = URI.file("C:/docs/Sample.pdf");
    const i = PdfEditorInput.create(uri, 5, "1.25");
    expect(i.typeId).toBe("parallx.editor.pdf");
    expect(PdfEditorInput.TYPE_ID).toBe("parallx.editor.pdf");
    expect(i.name).toBe(uri.basename);
    expect(i.description).toBe(uri.fsPath);
    expect(i.uri.toString()).toBe(uri.toString());
    expect(i.page).toBe(5);
    expect(i.scaleValue).toBe("1.25");
    expect(i.isDirty).toBe(false);
  });

  it("matches() only true for another PdfEditorInput with equal URI", () => {
    const uri = URI.file("C:/docs/a.pdf");
    const a = PdfEditorInput.create(uri);
    const b = PdfEditorInput.create(URI.file("C:/docs/a.pdf"));
    const c = PdfEditorInput.create(URI.file("C:/docs/b.pdf"));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
    expect(a.matches({ id: a.id } as any)).toBe(false);
  });

  it("serialize() emits { typeId, name, description, pinned:false, sticky:false, data:{uri,page,scaleValue} }", () => {
    const uri = URI.file("C:/x.pdf");
    const i = PdfEditorInput.create(uri, 3, "page-width");
    const s = i.serialize();
    expect(s.typeId).toBe("parallx.editor.pdf");
    expect(s.pinned).toBe(false);
    expect(s.sticky).toBe(false);
    expect((s.data as any).uri).toBe(uri.toString());
    expect((s.data as any).page).toBe(3);
    expect((s.data as any).scaleValue).toBe("page-width");
  });
});

describe("built-in/editor — EpubEditorInput", () => {
  it("create() records uri/scrollTop/fontScale; matches by URI; serialize data shape", () => {
    const uri = URI.file("C:/books/Book.epub");
    const i = EpubEditorInput.create(uri, 120, 1.4);
    expect(i.typeId).toBe("parallx.editor.epub");
    expect(EpubEditorInput.TYPE_ID).toBe("parallx.editor.epub");
    expect(i.name).toBe(uri.basename);
    expect(i.description).toBe(uri.fsPath);
    expect(i.scrollTop).toBe(120);
    expect(i.fontScale).toBe(1.4);
    expect(i.isDirty).toBe(false);

    const same = EpubEditorInput.create(URI.file("C:/books/Book.epub"));
    expect(i.matches(same)).toBe(true);
    expect(i.matches(EpubEditorInput.create(URI.file("C:/books/Other.epub")))).toBe(false);

    const s = i.serialize();
    expect(s.typeId).toBe("parallx.editor.epub");
    expect(s.pinned).toBe(false);
    expect(s.sticky).toBe(false);
    expect((s.data as any).uri).toBe(uri.toString());
    expect((s.data as any).scrollTop).toBe(120);
    expect((s.data as any).fontScale).toBe(1.4);
  });
});

describe("built-in/editor — ReadonlyMarkdownInput", () => {
  it("create() assigns id=`readonly-md-N` and uri=`parallx-readonly-md://<id>`", () => {
    const a = ReadonlyMarkdownInput.create("hello", "First");
    const b = ReadonlyMarkdownInput.create("world", "Second");
    expect(a.id).toMatch(/^readonly-md-\d+$/);
    expect(b.id).toMatch(/^readonly-md-\d+$/);
    expect(a.id).not.toBe(b.id);
    expect(a.uri.toString()).toBe(`parallx-readonly-md://${a.id}`);
    expect(a.name).toBe("First");
    expect(a.description).toBe("");
    expect(a.content).toBe("hello");
    expect(a.isDirty).toBe(false);
    expect(a.typeId).toBe("parallx.editor.readonlyMarkdown");
  });

  it("updateContent() fires onDidChangeContent only when value differs", () => {
    const i = ReadonlyMarkdownInput.create("a", "X");
    const fired = vi.fn();
    i.onDidChangeContent(fired);
    i.updateContent("a");
    expect(fired).not.toHaveBeenCalled();
    i.updateContent("b");
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith("b");
    expect(i.content).toBe("b");
  });

  it("save()/revert()/confirmClose() honor read-only / transient contract", async () => {
    const i = ReadonlyMarkdownInput.create("a", "X");
    await expect(i.save()).resolves.toBeUndefined();
    await expect(i.revert()).resolves.toBeUndefined();
    await expect(i.confirmClose()).resolves.toBe(true);
  });

  it("serialize() emits { typeId, name, pinned:false, sticky:false, data:{content} }", () => {
    const i = ReadonlyMarkdownInput.create("payload", "Name");
    const s = i.serialize();
    expect(s.typeId).toBe("parallx.editor.readonlyMarkdown");
    expect(s.name).toBe("Name");
    expect(s.pinned).toBe(false);
    expect(s.sticky).toBe(false);
    expect((s.data as any).content).toBe("payload");
  });
});

describe("built-in/editor — MarkdownPreviewInput", () => {
  function fakeSource(uri: URI, name: string, description: string, content: string) {
    const listeners: Array<(v: string) => void> = [];
    return {
      uri,
      name,
      description,
      content,
      resolve: vi.fn(async () => "resolved" as any),
      onDidChangeContent: (cb: (v: string) => void) => {
        listeners.push(cb);
        return { dispose() { /* noop */ } };
      },
      // helper to fire
      __fire: (v: string) => listeners.forEach((l) => l(v)),
    };
  }

  it("create() composes id from source URI + #preview, name='Preview <src.name>', not dirty", () => {
    const src = fakeSource(URI.file("C:/notes/a.md"), "a.md", "C:/notes/a.md", "# hi");
    const p = MarkdownPreviewInput.create(src as any);
    expect(p.typeId).toBe("parallx.editor.markdownPreview");
    expect(MarkdownPreviewInput.TYPE_ID).toBe("parallx.editor.markdownPreview");
    expect(p.id).toBe(src.uri.toKey() + "#preview");
    expect(p.name).toBe("Preview a.md");
    expect(p.description).toBe("C:/notes/a.md");
    expect(p.isDirty).toBe(false);
    expect(p.uri.toString()).toBe(src.uri.toString());
    expect(p.sourceInput).toBe(src);
  });

  it("forwards .content and .onDidChangeContent and .resolve() to the source", async () => {
    const src = fakeSource(URI.file("C:/notes/b.md"), "b.md", "C:/notes/b.md", "body");
    const p = MarkdownPreviewInput.create(src as any);
    expect(p.content).toBe("body");
    const fired = vi.fn();
    p.onDidChangeContent(fired);
    src.__fire("updated");
    expect(fired).toHaveBeenCalledWith("updated");
    await expect(p.resolve()).resolves.toBe("resolved");
    expect(src.resolve).toHaveBeenCalled();
  });

  it("matches() returns true only for another MarkdownPreviewInput with equal source URI", () => {
    const s1 = fakeSource(URI.file("C:/notes/c.md"), "c.md", "", "x");
    const s2 = fakeSource(URI.file("C:/notes/c.md"), "c.md", "", "y");
    const s3 = fakeSource(URI.file("C:/notes/d.md"), "d.md", "", "z");
    const p1 = MarkdownPreviewInput.create(s1 as any);
    const p2 = MarkdownPreviewInput.create(s2 as any);
    const p3 = MarkdownPreviewInput.create(s3 as any);
    expect(p1.matches(p2)).toBe(true);
    expect(p1.matches(p3)).toBe(false);
    expect(p1.matches({ id: p1.id } as any)).toBe(false);
  });

  it("serialize() emits { typeId, name, description, pinned:true, sticky:false, data:{uri} }", () => {
    const uri = URI.file("C:/notes/e.md");
    const src = fakeSource(uri, "e.md", "C:/notes/e.md", "body");
    const p = MarkdownPreviewInput.create(src as any);
    const s = p.serialize();
    expect(s.typeId).toBe("parallx.editor.markdownPreview");
    expect(s.name).toBe("Preview e.md");
    expect(s.pinned).toBe(true);
    expect(s.sticky).toBe(false);
    expect((s.data as any).uri).toBe(uri.toString());
  });
});
