/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { createOpenclawCanvasParticipant } from "../../src/openclaw/participants/openclawCanvasParticipant";

function makeStream() {
  const md: string[] = [];
  const refs: Array<{ uri: string; label?: string }> = [];
  const progress: string[] = [];
  const warnings: string[] = [];
  const stream: any = {
    markdown(s: string) { md.push(s); },
    reference(uri: string, label?: string) { refs.push({ uri, label }); },
    progress(s: string) { progress.push(s); },
    warning(s: string) { warnings.push(s); },
    codeBlock: () => {}, provenance: () => {}, thinking: () => {},
    button: () => {}, confirmation: () => {},
    beginToolInvocation: () => {}, updateToolInvocation: () => {},
    editProposal: () => {}, editBatch: () => {}, push: () => {},
  };
  return { stream, md, refs, progress, warnings, all: () => md.join("\n") };
}

function makeToken(cancelled = false) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => {} }),
  } as any;
}

function makeServices(over: any = {}) {
  return {
    getCurrentPageId: () => null,
    getPageStructure: vi.fn(async () => null),
    reportRetrievalDebug: vi.fn(),
    reportBootstrapDebug: vi.fn(),
    getActiveModel: () => "test-model",
    getWorkspaceName: () => "ws",
    getReadOnlyToolDefinitions: () => [],
    sendChatRequest: vi.fn(),
    readFileContent: undefined,
    unifiedConfigService: undefined,
    agentRegistry: undefined,
    observabilityService: undefined,
    filterToolsForSession: undefined,
    invokeToolWithRuntimeControl: undefined,
    runtimeHookRegistry: undefined,
    ...over,
  };
}

describe("createOpenclawCanvasParticipant — shape", () => {
  it("exposes the canvas participant contract", () => {
    const p = createOpenclawCanvasParticipant(makeServices() as any);
    expect(p.id).toBe("parallx.chat.canvas");
    expect(p.surface).toBe("canvas");
    expect(p.displayName).toBe("Canvas");
    expect(typeof p.description).toBe("string");
    expect(Array.isArray(p.commands)).toBe(true);
    expect(p.commands!.map((c: any) => c.name).sort()).toEqual(["blocks", "describe"]);
    expect(typeof p.handler).toBe("function");
    expect(typeof p.dispose).toBe("function");
    // runtime.handleTurn is the same function as handler.
    expect(p.runtime?.handleTurn).toBe(p.handler);
  });

  it("dispose is a no-op that does not throw", () => {
    const p = createOpenclawCanvasParticipant(makeServices() as any);
    expect(() => p.dispose()).not.toThrow();
  });
});

describe("createOpenclawCanvasParticipant — retrieval debug", () => {
  it("reports retrieval debug as not-attempted on every turn", async () => {
    const services = makeServices();
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream } = makeStream();
    await p.handler(
      { command: "describe", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(services.reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: true,
      isRagReady: false,
      needsRetrieval: false,
      attempted: false,
    });
  });

  it("hasActiveSlashCommand is false for the general lane", async () => {
    const services = makeServices();
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream } = makeStream();
    await p.handler(
      { command: undefined, text: "hi", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(services.reportRetrievalDebug).toHaveBeenCalledWith(
      expect.objectContaining({ hasActiveSlashCommand: false, attempted: false }),
    );
  });
});

describe("createOpenclawCanvasParticipant — /describe", () => {
  it("emits the 'no page' message when no page is open", async () => {
    const services = makeServices({ getCurrentPageId: () => null });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "describe", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/No page is currently open\. .*@canvas \/describe/);
    expect(r).toEqual({});
    expect(services.getPageStructure).not.toHaveBeenCalled();
  });

  it("emits 'Could not read page structure' when getPageStructure returns null", async () => {
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => null),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "describe", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/Could not read page structure for `p1`/);
    expect(r).toEqual({});
  });

  it("returns {} immediately when cancellation is requested before reading", async () => {
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => ({ title: "T", icon: null, blocks: [] })),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream } = makeStream();
    const r = await p.handler(
      { command: "describe", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(true),
    );
    expect(r).toEqual({});
    expect(services.getPageStructure).not.toHaveBeenCalled();
  });
});

describe("createOpenclawCanvasParticipant — /blocks", () => {
  it("emits the 'no page' message when no page is open", async () => {
    const services = makeServices({ getCurrentPageId: () => null });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "blocks", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/No page is currently open\. .*@canvas \/blocks/);
    expect(r).toEqual({});
  });

  it("emits 'no blocks yet' for an empty page and references the page once", async () => {
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => ({ title: "My Page", icon: "📄", blocks: [] })),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all, refs } = makeStream();
    await p.handler(
      { command: "blocks", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/\*\*My Page\*\* has no blocks yet\./);
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe("parallx://page/p1");
  });

  it("renders one bullet per block, truncates long previews, and adds a block reference for each", async () => {
    const longText = "x".repeat(200);
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => ({
        title: "My Page",
        icon: "📄",
        blocks: [
          { id: "aaaaaaaa11111111", blockType: "paragraph", textPreview: "short" },
          { id: "bbbbbbbb22222222", blockType: "heading", textPreview: longText },
          { id: "cccccccc33333333", blockType: "code", textPreview: "" },
        ],
      })),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all, refs } = makeStream();
    await p.handler(
      { command: "blocks", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/\*\*3 blocks\*\* on "My Page"/);
    expect(all()).toMatch(/\*\*paragraph\*\* `aaaaaaaa\.\.\.` — short/);
    // 80-char cap + ellipsis on long preview.
    const heading = all().split("\n").find((l) => l.includes("heading"))!;
    expect(heading).toMatch(/`bbbbbbbb\.\.\.` — x{80}\.\.\.$/);
    // Empty preview → no em dash suffix.
    expect(all()).toMatch(/\*\*code\*\* `cccccccc\.\.\.`$/m);
    // 1 reference for the page + 1 per block.
    expect(refs.map((r) => r.uri)).toEqual([
      "parallx://page/p1",
      "parallx://block/aaaaaaaa11111111",
      "parallx://block/bbbbbbbb22222222",
      "parallx://block/cccccccc33333333",
    ]);
  });

  it("uses singular 'block' wording for exactly one block", async () => {
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => ({
        title: "Solo",
        icon: null,
        blocks: [{ id: "12345678abcdefgh", blockType: "paragraph", textPreview: "hi" }],
      })),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, all } = makeStream();
    await p.handler(
      { command: "blocks", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(all()).toMatch(/\*\*1 block\*\* on "Solo"/);
    expect(all()).not.toMatch(/\*\*1 blocks\*\*/);
  });

  it("falls back to the default icon when icon is missing", async () => {
    const services = makeServices({
      getCurrentPageId: () => "p1",
      getPageStructure: vi.fn(async () => ({ title: "T", icon: undefined, blocks: [] })),
    });
    const p = createOpenclawCanvasParticipant(services as any);
    const { stream, refs } = makeStream();
    await p.handler(
      { command: "blocks", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any,
      stream,
      makeToken(),
    );
    expect(refs[0].label).toBe("📄 T");
  });
});
