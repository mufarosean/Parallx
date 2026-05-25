// resourceService.test.ts — M83-W3 seed coverage.
//
// Verifies the URI → typed handle classification that future cross-tool
// migrations (Explorer→Canvas drop, chat→editor open) will resolve
// through. The tests assert kind detection and label derivation; they do
// NOT assert downstream wiring, because no consumer has been migrated
// yet (that is the W3 follow-up).

import { describe, expect, it } from "vitest";

import { URI } from "../../src/platform/uri.js";
import { ResourceService } from "../../src/services/resourceService.js";

describe("ResourceService — seed (M83-W3)", () => {
  const svc = new ResourceService();

  it("classifies file:// URIs as 'file' and labels with the basename", () => {
    const handle = svc.resolve(URI.file("/Users/x/notes.md"));
    expect(handle.kind).toBe("file");
    expect(handle.label).toBe("notes.md");
    expect(handle.uri.scheme).toBe("file");
  });

  it("classifies untitled: URIs as 'untitled'", () => {
    const handle = svc.parse("untitled:Untitled-1");
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe("untitled");
    expect(handle!.label).toBe("Untitled-1");
  });

  it("classifies canvas-page:// URIs and labels by page id", () => {
    const handle = svc.parse("canvas-page://workspace/abc-123");
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe("canvas-page");
    expect(handle!.label).toBe("page:abc-123");
  });

  it("classifies canvas-block:// URIs and labels by block id when fragment present", () => {
    const handle = svc.parse("canvas-block://workspace/page-1#block-7");
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe("canvas-block");
    expect(handle!.label).toBe("block:block-7");
  });

  it("classifies artifact:// URIs", () => {
    const handle = svc.parse("artifact://chat/abc");
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe("artifact");
    expect(handle!.label).toBe("artifact:abc");
  });

  it("returns 'unknown' for unrecognized schemes (never throws)", () => {
    const handle = svc.parse("widget://thing/42");
    expect(handle).toBeDefined();
    expect(handle!.kind).toBe("unknown");
  });

  it("returns undefined when parse cannot produce a URI", () => {
    // Empty string and bare text have no scheme — must NOT be classified
    // as 'unknown'; consumers rely on undefined to distinguish parse
    // failure from a valid-but-unrecognized URI.
    expect(svc.parse("")).toBeUndefined();
  });

  it("does not throw when resolving non-file URIs (fsPath is guarded)", () => {
    // canvas-page URI must not invoke fsPath, which throws on non-file
    // URIs. This is the regression we are pinning the kind-gated branch
    // against.
    expect(() => svc.parse("canvas-page://workspace/p1")).not.toThrow();
  });
});
