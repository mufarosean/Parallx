/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { tryHandleOpenclawContextCommand } from "../../src/openclaw/participants/openclawContextReport";

function makeStream() {
  const md: string[] = [];
  const stream: any = {
    markdown(s: string) { md.push(s); },
    codeBlock: () => {}, progress: () => {}, provenance: () => {}, reference: () => {},
    thinking: () => {}, warning: () => {}, button: () => {}, confirmation: () => {},
    beginToolInvocation: () => {}, updateToolInvocation: () => {},
    editProposal: () => {}, editBatch: () => {}, push: () => {},
  };
  return { stream, md, all: () => md.join("\n") };
}

function makeRunReport(): any {
  return {
    source: "run",
    workspaceName: "ws",
    bootstrapMaxChars: 1000,
    bootstrapTotalMaxChars: 5000,
    bootstrapWarningLines: [],
    injectedWorkspaceFiles: [],
    systemPrompt: { chars: 1234, projectContextChars: 500, nonProjectContextChars: 734 },
    skills: { promptChars: 100, visibleCount: 0, totalCount: 0, hiddenCount: 0, entries: [], catalog: [] },
    tools: {
      listChars: 50, schemaChars: 0, availableCount: 0, totalCount: 0,
      skillDerivedCount: 0, filteredCount: 0, entries: [],
    },
    promptProvenance: undefined,
  };
}

const baseServices = (overrides: any = {}) => ({
  getActiveModel: () => "m",
  getWorkspaceName: () => "ws",
  readFileRelative: undefined,
  unifiedConfigService: undefined,
  getToolDefinitions: () => [],
  getReadOnlyToolDefinitions: () => [],
  getSkillCatalog: () => [],
  getToolPermissions: () => ({}),
  getModelContextLength: () => 0,
  getLastSystemPromptReport: () => makeRunReport(),
  reportSystemPromptReport: vi.fn(),
  getWorkspaceDigest: async () => "",
  getMindMapDiagnostics: undefined,
  ...overrides,
});

describe("tryHandleOpenclawContextCommand — routing", () => {
  it("returns { handled: false } when command is not 'context'", async () => {
    const { stream, md } = makeStream();
    const r = await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "other", text: "", mode: 0 } as any,
      stream,
    );
    expect(r.handled).toBe(false);
    expect(md).toEqual([]);
  });

  it("prints help when no sub is given", async () => {
    const { stream, all } = makeStream();
    const r = await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "", mode: 0 } as any,
      stream,
    );
    expect(r.handled).toBe(true);
    expect(r.report).toBeUndefined();
    expect(all()).toMatch(/## \/context/);
    expect(all()).toMatch(/\/context list/);
    expect(all()).toMatch(/\/context json/);
  });

  it("prints help when sub is 'help'", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "help", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/## \/context/);
  });

  it("prints 'Unknown' message for unrecognised subs", async () => {
    const { stream, all } = makeStream();
    const r = await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "boom", mode: 0 } as any,
      stream,
    );
    expect(r.handled).toBe(true);
    expect(r.report).toBeUndefined();
    expect(all()).toMatch(/Unknown `\/context` mode/);
  });
});

describe("tryHandleOpenclawContextCommand — render modes", () => {
  it("'json' emits a fenced JSON block with the report", async () => {
    const { stream, all } = makeStream();
    const report = makeRunReport();
    const svc = baseServices({ getLastSystemPromptReport: () => report });
    const r = await tryHandleOpenclawContextCommand(
      svc as any,
      { command: "context", text: "json", mode: 0 } as any,
      stream,
    );
    expect(r.handled).toBe(true);
    expect(r.report).toBe(report);
    expect(all()).toMatch(/^```json/m);
    expect(all()).toMatch(/"workspaceName": "ws"/);
    // Existing 'run' report is reused, so reportSystemPromptReport is NOT called.
    expect(svc.reportSystemPromptReport).not.toHaveBeenCalled();
  });

  it("'list' emits the non-detailed header", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "list", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/🧠 Context breakdown/);
    expect(all()).not.toMatch(/Context breakdown \(detailed\)/);
  });

  it("'detail' emits the detailed header", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "detail", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/🧠 Context breakdown \(detailed\)/);
  });

  it("'deep' is treated as detailed", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices() as any,
      { command: "context", text: "deep", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/🧠 Context breakdown \(detailed\)/);
  });

  it("appends 'Context window' only when getModelContextLength returns > 0", async () => {
    const a = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices({ getModelContextLength: () => 0 }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      a.stream,
    );
    expect(a.all()).not.toMatch(/Context window:/);
    const b = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices({ getModelContextLength: () => 8192 }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      b.stream,
    );
    expect(b.all()).toMatch(/Context window: 8,192 tok/);
  });
});

describe("tryHandleOpenclawContextCommand — Mind Map section", () => {
  it("appends the Mind Map section when diagnostics are present", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices({
        getMindMapDiagnostics: async () => ({
          edgeCountsByKind: [{ kind: "link", count: 3 }],
          totalEdges: 3,
          conceptCount: 2,
          conceptDeletedCount: 0,
          conceptRenamedCount: 1,
          sourcesWithDistinctiveTerms: 4,
          lastRefreshAt: "2026-05-01T00:00:00Z",
          lastRefreshStatus: "ok",
        }),
      }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/🕸️ Mind map/);
    expect(all()).toMatch(/Edges total: 3/);
    expect(all()).toMatch(/- link: 3/);
    expect(all()).toMatch(/Concepts: 2 active, 0 user-deleted, 1 user-renamed/);
    expect(all()).toMatch(/Last refresh: 2026-05-01T00:00:00Z \(ok\)/);
  });

  it("renders 'never' and the empty-state hint when no edges or concepts exist", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices({
        getMindMapDiagnostics: async () => ({
          edgeCountsByKind: [],
          totalEdges: 0,
          conceptCount: 0,
          conceptDeletedCount: 0,
          conceptRenamedCount: 0,
          sourcesWithDistinctiveTerms: 0,
          lastRefreshAt: null,
          lastRefreshStatus: null,
        }),
      }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      stream,
    );
    expect(all()).toMatch(/No cached edges or concept nodes yet/);
  });

  it("swallows failures from getMindMapDiagnostics", async () => {
    const { stream, all } = makeStream();
    const r = await tryHandleOpenclawContextCommand(
      baseServices({
        getMindMapDiagnostics: async () => { throw new Error("boom"); },
      }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      stream,
    );
    expect(r.handled).toBe(true);
    expect(all()).not.toMatch(/🕸️ Mind map/);
  });

  it("does not call getMindMapDiagnostics when the dep is absent", async () => {
    const { stream, all } = makeStream();
    await tryHandleOpenclawContextCommand(
      baseServices({ getMindMapDiagnostics: undefined }) as any,
      { command: "context", text: "list", mode: 0 } as any,
      stream,
    );
    expect(all()).not.toMatch(/🕸️ Mind map/);
  });
});
