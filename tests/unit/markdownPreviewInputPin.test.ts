/**
 * Pin: MarkdownPreviewInput — read-only EditorInput that wraps a
 * FileEditorInput for live markdown preview.  Covers TYPE_ID, factory,
 * id derived from source URI + #preview, label format, forwarded
 * description / content / onDidChangeContent / resolve(), source
 * URI–based matches(), and serialize() shape.
 */
import { describe, it, expect, vi } from "vitest";
import { MarkdownPreviewInput } from "../../src/built-in/editor/markdownPreviewInput";
import { URI } from "../../src/platform/uri";

function makeFileInput(uriStr: string, over: any = {}) {
  const uri = URI.parse(uriStr);
  const fake = {
    uri,
    name: "doc.md",
    description: "in /folder",
    content: "# Hi",
    onDidChangeContent: vi.fn() as any,
    resolve: vi.fn(async () => "resolved" as any),
    ...over,
  };
  return fake as any;
}

describe("MarkdownPreviewInput — static surface", () => {
  it("TYPE_ID is 'parallx.editor.markdownPreview'", () => {
    expect(MarkdownPreviewInput.TYPE_ID).toBe("parallx.editor.markdownPreview");
  });

  it("create() returns an instance", () => {
    const src = makeFileInput("file:///a/b.md");
    expect(MarkdownPreviewInput.create(src)).toBeInstanceOf(MarkdownPreviewInput);
  });
});

describe("MarkdownPreviewInput — identity / id / labels", () => {
  it("id is source URI key suffixed with '#preview'", () => {
    const src = makeFileInput("file:///a/b.md");
    const input = MarkdownPreviewInput.create(src);
    expect(input.id).toBe(src.uri.toKey() + "#preview");
  });

  it("typeId returns TYPE_ID", () => {
    const input = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    expect(input.typeId).toBe(MarkdownPreviewInput.TYPE_ID);
  });

  it("name prefixes source name with 'Preview '", () => {
    const input = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md", { name: "doc.md" }));
    expect(input.name).toBe("Preview doc.md");
  });

  it("description forwards from the source input", () => {
    const input = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md", { description: "/in/here" }));
    expect(input.description).toBe("/in/here");
  });

  it("isDirty is always false", () => {
    const input = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    expect(input.isDirty).toBe(false);
  });

  it("uri returns the source URI instance", () => {
    const src = makeFileInput("file:///a/b.md");
    expect(MarkdownPreviewInput.create(src).uri).toBe(src.uri);
  });

  it("sourceInput exposes the wrapped FileEditorInput", () => {
    const src = makeFileInput("file:///a/b.md");
    expect(MarkdownPreviewInput.create(src).sourceInput).toBe(src);
  });
});

describe("MarkdownPreviewInput — forwarded source surface", () => {
  it("content reads through to source.content", () => {
    const src = makeFileInput("file:///a.md", { content: "BODY" });
    const input = MarkdownPreviewInput.create(src);
    expect(input.content).toBe("BODY");
    src.content = "NEW";
    expect(input.content).toBe("NEW");
  });

  it("onDidChangeContent returns the source's emitter event", () => {
    const event = vi.fn() as any;
    const src = makeFileInput("file:///a.md", { onDidChangeContent: event });
    expect(MarkdownPreviewInput.create(src).onDidChangeContent).toBe(event);
  });

  it("resolve() awaits and returns source.resolve() result", async () => {
    const resolve = vi.fn(async () => "RES");
    const src = makeFileInput("file:///a.md", { resolve });
    const input = MarkdownPreviewInput.create(src);
    await expect(input.resolve()).resolves.toBe("RES");
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("MarkdownPreviewInput — matches()", () => {
  it("matches another MarkdownPreviewInput with equal source URI", () => {
    const a = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    const b = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    expect(a.matches(b)).toBe(true);
  });

  it("does not match a MarkdownPreviewInput with different source URI", () => {
    const a = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    const c = MarkdownPreviewInput.create(makeFileInput("file:///x/y.md"));
    expect(a.matches(c)).toBe(false);
  });

  it("does not match non-MarkdownPreviewInput instances", () => {
    const a = MarkdownPreviewInput.create(makeFileInput("file:///a/b.md"));
    // Same id but different class — still does not match.
    expect(a.matches({ id: a.id } as any)).toBe(false);
  });
});

describe("MarkdownPreviewInput — serialize()", () => {
  it("returns shape with pinned:true, sticky:false, and data.uri = source URI string", () => {
    const src = makeFileInput("file:///a/b.md", { name: "b.md", description: "/a" });
    const input = MarkdownPreviewInput.create(src);
    expect(input.serialize()).toEqual({
      inputId: input.id,
      typeId: MarkdownPreviewInput.TYPE_ID,
      name: "Preview b.md",
      description: "/a",
      pinned: true,
      sticky: false,
      data: { uri: src.uri.toString() },
    });
  });
});
