// Pin: createParallxLinkTool — descriptor identity, missing/invalid target
// rejection, unknown segment surface known list, anchor concatenation rules
// (leading `?`/`&` rejected, `?` vs `&` separator chosen by existing query),
// note pass-through.
import { describe, it, expect, vi } from "vitest";
import { createParallxLinkTool } from "../../src/built-in/chat/tools/parallxLinkTool";

function snapshot(...segments: { segment: string; displayName: string }[]) {
  return () => segments.map(s => ({ ...s, kinds: [] as any[] }));
}

const noToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;

async function call(tool: any, args: Record<string, unknown>) {
  const r = await tool.handler(args, noToken);
  return { raw: r, body: JSON.parse(r.content) };
}

describe("built-in/chat/tools/parallxLinkTool", () => {
  it("descriptor pins name, permissionLevel, source, requiresConfirmation, parameter schema", () => {
    const tool = createParallxLinkTool(snapshot());
    expect(tool.name).toBe("parallx_link");
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.permissionLevel).toBe("always-allowed");
    expect(tool.source).toBe("built-in");
    const p: any = tool.parameters;
    expect(p.type).toBe("object");
    expect(p.required).toEqual(["target"]);
    expect(Object.keys(p.properties).sort()).toEqual(["anchor", "note", "target"]);
  });

  it("missing target → error tool result", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { raw, body } = await call(tool, {});
    expect(raw.isError).toBe(true);
    expect(body).toEqual({ ok: false, error: "Missing required argument: target" });
  });

  it("non-parallx URI → error", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { raw, body } = await call(tool, { target: "https://example.com" });
    expect(raw.isError).toBe(true);
    expect(body.error).toBe("target is not a valid parallx:// URI");
  });

  it("unknown segment surfaces the registered segment list", async () => {
    const tool = createParallxLinkTool(snapshot(
      { segment: "page", displayName: "Pages" },
      { segment: "task", displayName: "Tasks" },
    ));
    const { body } = await call(tool, { target: "parallx://wat/abc" });
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Unknown segment "wat"');
    expect(body.error).toContain("page");
    expect(body.error).toContain("task");
  });

  it("unknown segment with empty registry shows `(none registered)`", async () => {
    const tool = createParallxLinkTool(snapshot());
    const { body } = await call(tool, { target: "parallx://page/abc" });
    expect(body.error).toContain("(none registered)");
  });

  it("happy path returns ok + uri + segment + displayName + note", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { raw, body } = await call(tool, { target: "parallx://page/abc", note: "see here" });
    expect(raw.isError).toBeUndefined();
    expect(body).toEqual({
      ok: true,
      uri: "parallx://page/abc",
      segment: "page",
      displayName: "Pages",
      note: "see here",
    });
  });

  it("anchor starting with `?` or `&` is rejected", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    for (const bad of ["?x=1", "&x=1"]) {
      const { raw, body } = await call(tool, { target: "parallx://page/abc", anchor: bad });
      expect(raw.isError).toBe(true);
      expect(body.error).toMatch(/must not start with `\?` or `&`/);
    }
  });

  it("anchor concatenates with `?` when target has no query", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { body } = await call(tool, { target: "parallx://page/abc", anchor: "hl=1" });
    expect(body.uri).toBe("parallx://page/abc?hl=1");
  });

  it("anchor concatenates with `&` when target already has `?`", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { body } = await call(tool, { target: "parallx://page/abc?x=1", anchor: "y=2" });
    expect(body.uri).toBe("parallx://page/abc?x=1&y=2");
  });

  it("note is optional (undefined when not provided)", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    const { body } = await call(tool, { target: "parallx://page/abc" });
    expect(body.note).toBeUndefined();
  });

  it("empty-string target/anchor/note are treated as missing (readString predicate)", async () => {
    const tool = createParallxLinkTool(snapshot({ segment: "page", displayName: "Pages" }));
    // empty target → missing
    const a = await call(tool, { target: "" });
    expect(a.body.error).toBe("Missing required argument: target");
    // empty anchor → ignored (no `?` appended)
    const b = await call(tool, { target: "parallx://page/abc", anchor: "" });
    expect(b.body.uri).toBe("parallx://page/abc");
  });

  it("getContracts is consulted on every handler invocation (snapshot semantics)", async () => {
    const getContracts = vi.fn(() => [{ segment: "page", displayName: "Pages", kinds: [] as any[] }]);
    const tool = createParallxLinkTool(getContracts);
    await call(tool, { target: "parallx://page/abc" });
    await call(tool, { target: "parallx://page/def" });
    expect(getContracts).toHaveBeenCalledTimes(2);
  });
});
