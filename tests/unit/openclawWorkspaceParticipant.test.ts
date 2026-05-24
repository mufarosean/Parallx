/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { createOpenclawWorkspaceParticipant } from "../../src/openclaw/participants/openclawWorkspaceParticipant";

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
    listPages: vi.fn(async () => []),
    searchPages: vi.fn(async () => []),
    getPageTitle: vi.fn(async () => null),
    getPageContent: vi.fn(async () => ""),
    listFiles: undefined,
    readFileContent: undefined,
    getActiveModel: () => "test-model",
    getWorkspaceName: () => "MyWs",
    getReadOnlyToolDefinitions: () => [],
    sendChatRequest: vi.fn(),
    reportRetrievalDebug: vi.fn(),
    reportBootstrapDebug: vi.fn(),
    unifiedConfigService: undefined,
    agentRegistry: undefined,
    observabilityService: undefined,
    filterToolsForSession: undefined,
    invokeToolWithRuntimeControl: undefined,
    runtimeHookRegistry: undefined,
    ...over,
  };
}

describe("createOpenclawWorkspaceParticipant — shape", () => {
  it("exposes the workspace participant contract", () => {
    const p = createOpenclawWorkspaceParticipant(makeServices() as any);
    expect(p.id).toBe("parallx.chat.workspace");
    expect(p.surface).toBe("workspace");
    expect(p.displayName).toBe("Workspace");
    expect(typeof p.description).toBe("string");
    expect(p.commands!.map((c: any) => c.name).sort()).toEqual(["list", "search", "summarize"]);
    expect(p.runtime?.handleTurn).toBe(p.handler);
    expect(() => p.dispose()).not.toThrow();
  });

  it("emits retrieval debug as not-attempted on every turn", async () => {
    const services = makeServices();
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream } = makeStream();
    await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(services.reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: true,
      isRagReady: false,
      needsRetrieval: false,
      attempted: false,
    });
  });
});

describe("createOpenclawWorkspaceParticipant — /list", () => {
  it("emits the empty-state message when no pages exist", async () => {
    const services = makeServices({ listPages: vi.fn(async () => []) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/Your workspace has no pages yet/);
  });

  it("returns {} immediately when cancellation is requested", async () => {
    const services = makeServices({ listPages: vi.fn(async () => [{ id: "x", title: "t" }]) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream } = makeStream();
    const r = await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(true),
    );
    expect(r).toEqual({});
    expect(services.listPages).not.toHaveBeenCalled();
  });

  it("lists pages, references each, and uses plural wording for >1 page", async () => {
    const pages = [
      { id: "p1", title: "First", icon: "📝" },
      { id: "p2", title: "Second", icon: null },
    ];
    const services = makeServices({ listPages: vi.fn(async () => pages) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all, refs } = makeStream();
    await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/\*\*2 pages\*\* in "MyWs"/);
    expect(all()).toMatch(/- 📝 First/);
    expect(all()).toMatch(/- 📄 Second/);
    expect(refs.map((r) => r.uri)).toEqual([
      "parallx://page/p1",
      "parallx://page/p2",
    ]);
    expect(refs[0].label).toBe("📝 First");
    expect(refs[1].label).toBe("📄 Second");
  });

  it("uses singular wording for exactly one page", async () => {
    const services = makeServices({
      listPages: vi.fn(async () => [{ id: "p1", title: "Only", icon: null }]),
    });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/\*\*1 page\*\* in "MyWs"/);
    expect(all()).not.toMatch(/\*\*1 pages\*\*/);
  });

  it("caps the displayed list at 50 and shows the overflow line", async () => {
    const pages = Array.from({ length: 53 }, (_, i) => ({
      id: `p${i}`, title: `T${i}`, icon: null,
    }));
    const services = makeServices({ listPages: vi.fn(async () => pages) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all, refs } = makeStream();
    await p.handler(
      { command: "list", text: "", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(refs).toHaveLength(50);
    expect(all()).toMatch(/\*\*53 pages\*\* in "MyWs"/);
    expect(all()).toMatch(/\.\.\. and 3 more\./);
  });
});

describe("createOpenclawWorkspaceParticipant — /search", () => {
  it("rejects an empty query", async () => {
    const services = makeServices();
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "search", text: "   ", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/Please provide a search query/);
    expect(r).toEqual({});
    expect(services.searchPages).not.toHaveBeenCalled();
  });

  it("emits 'No pages found' when results are empty", async () => {
    const services = makeServices({ searchPages: vi.fn(async () => []) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "search", text: "meeting notes", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/No pages found matching "meeting notes"\./);
    expect(r).toEqual({});
    expect(services.searchPages).toHaveBeenCalledWith("meeting notes");
  });

  it("returns {} immediately when cancellation is requested before searching", async () => {
    const services = makeServices({ searchPages: vi.fn(async () => [{ id: "x" }]) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream } = makeStream();
    const r = await p.handler(
      { command: "search", text: "q", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(true),
    );
    expect(r).toEqual({});
    expect(services.searchPages).not.toHaveBeenCalled();
  });
});

describe("createOpenclawWorkspaceParticipant — /summarize", () => {
  it("rejects a missing page id", async () => {
    const services = makeServices();
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "summarize", text: "   ", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/Please provide a page ID/);
    expect(r).toEqual({});
    expect(services.getPageTitle).not.toHaveBeenCalled();
  });

  it("emits 'Page not found' when getPageTitle returns null", async () => {
    const services = makeServices({ getPageTitle: vi.fn(async () => null) });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream, all } = makeStream();
    const r = await p.handler(
      { command: "summarize", text: "p-missing", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(),
    );
    expect(all()).toMatch(/Page not found: `p-missing`/);
    expect(r).toEqual({});
    expect(services.getPageTitle).toHaveBeenCalledWith("p-missing");
  });

  it("returns {} immediately when cancellation is requested", async () => {
    const services = makeServices({ getPageTitle: vi.fn(async () => "T") });
    const p = createOpenclawWorkspaceParticipant(services as any);
    const { stream } = makeStream();
    const r = await p.handler(
      { command: "summarize", text: "p1", mode: 0 } as any,
      { history: [], sessionId: "s" } as any, stream, makeToken(true),
    );
    expect(r).toEqual({});
    expect(services.getPageTitle).not.toHaveBeenCalled();
  });
});
