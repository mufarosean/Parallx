import { describe, it, expect } from "vitest";
import { buildOpenclawPromptArtifacts } from "../../src/openclaw/openclawPromptArtifacts";
import type { IOpenclawRuntimeSkillState } from "../../src/openclaw/openclawSkillState";
import type { IOpenclawRuntimeToolState } from "../../src/openclaw/openclawToolState";
import type {
  IOpenclawBootstrapDebugReport,
  IOpenclawSystemPromptReport,
} from "../../src/services/chatRuntimeTypes";
import type { IOpenclawRuntimeInfo } from "../../src/openclaw/openclawSystemPrompt";

function mkBootstrapReport(over: Partial<IOpenclawBootstrapDebugReport> = {}): IOpenclawBootstrapDebugReport {
  return {
    maxChars: 5000,
    totalMaxChars: 20000,
    totalRawChars: 0,
    totalInjectedChars: 0,
    files: [],
    warningLines: [],
    ...over,
  };
}

function mkRuntimeInfo(): IOpenclawRuntimeInfo {
  return {
    model: "test-model",
    provider: "test",
    host: "localhost",
    parallxVersion: "0.0.0-test",
  };
}

function mkSkillState(over: Partial<IOpenclawRuntimeSkillState> = {}): IOpenclawRuntimeSkillState {
  return {
    catalog: [],
    promptEntries: [],
    promptReportEntries: [],
    totalCount: 0,
    visibleCount: 0,
    hiddenCount: 0,
    compact: false,
    truncated: false,
    truncationNote: "",
    ...over,
  };
}

function mkToolState(over: Partial<IOpenclawRuntimeToolState> = {}): IOpenclawRuntimeToolState {
  return {
    exposedDefinitions: [],
    availableDefinitions: [],
    reportEntries: [],
    totalCount: 0,
    availableCount: 0,
    filteredCount: 0,
    skillDerivedCount: 0,
    ...over,
  };
}

describe("buildOpenclawPromptArtifacts — shape and provenance", () => {
  it("preserves source / workspaceName and uses systemPrompt as promptText", () => {
    const out = buildOpenclawPromptArtifacts({
      source: "estimate",
      workspaceName: "ws-x",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.source).toBe("estimate");
    expect(out.report.workspaceName).toBe("ws-x");
    expect(out.report.promptText).toBe(out.systemPrompt);
    expect(out.report.systemPrompt.chars).toBe(out.systemPrompt.length);
    expect(typeof out.report.generatedAt).toBe("number");
  });

  it("plumbs bootstrap report maxChars and totalMaxChars", () => {
    const br = mkBootstrapReport({ maxChars: 1234, totalMaxChars: 7654 });
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: br,
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.bootstrapMaxChars).toBe(1234);
    expect(out.report.bootstrapTotalMaxChars).toBe(7654);
  });

  it("plumbs injectedWorkspaceFiles and bootstrapWarningLines through verbatim", () => {
    const files = [
      { name: "AGENTS.md", rawChars: 10, injectedChars: 10, truncated: false, omitted: false },
    ] as IOpenclawBootstrapDebugReport["files"];
    const warnings = ["bootstrap: SOUL.md not found"];
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport({ files, warningLines: warnings }),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.injectedWorkspaceFiles).toBe(files);
    expect(out.report.bootstrapWarningLines).toEqual(warnings);
  });

  it("propagates promptProvenance into the report", () => {
    const prov: IOpenclawSystemPromptReport["promptProvenance"] = {
      bootstrapSource: "workspace",
      overlayApplied: false,
      hasSystemPromptAddition: false,
      hasPreferencesPrompt: false,
    } as unknown as IOpenclawSystemPromptReport["promptProvenance"];
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
      promptProvenance: prov,
    });
    expect(out.report.promptProvenance).toBe(prov);
  });
});

describe("buildOpenclawPromptArtifacts — skills accounting", () => {
  it("empty promptEntries → skills.promptChars === 0", () => {
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.skills.promptChars).toBe(0);
  });

  it("plumbs catalog/visibleCount/hiddenCount/totalCount/entries from skillState", () => {
    const catalog = [
      { name: "a", kind: "workflow", location: "L", modelVisible: true, modelVisibilityReason: "workflow-visible" as const },
    ];
    const promptReport = [{ name: "a", location: "L", blockChars: 42 }];
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState({
        catalog,
        promptEntries: [{ name: "a", description: "d", location: "L" }],
        promptReportEntries: promptReport,
        totalCount: 1,
        visibleCount: 1,
        hiddenCount: 0,
      }),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.skills.totalCount).toBe(1);
    expect(out.report.skills.visibleCount).toBe(1);
    expect(out.report.skills.hiddenCount).toBe(0);
    expect(out.report.skills.catalog).toBe(catalog);
    expect(out.report.skills.entries).toBe(promptReport);
    expect(out.report.skills.promptChars).toBeGreaterThan(0);
  });
});

describe("buildOpenclawPromptArtifacts — tools accounting", () => {
  it("empty availableDefinitions → tools.listChars === 0 and schemaChars === 0", () => {
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.tools.listChars).toBe(0);
    expect(out.report.tools.schemaChars).toBe(0);
  });

  it("schemaChars sums JSON.stringify(parameters) across availableDefinitions", () => {
    const tools = [
      { name: "t1", description: "d1", parameters: { type: "object", properties: { x: { type: "string" } } } },
      { name: "t2", description: "d2", parameters: { type: "object" } },
    ] as unknown as IOpenclawRuntimeToolState["availableDefinitions"];
    const expected =
      JSON.stringify(tools[0].parameters).length +
      JSON.stringify(tools[1].parameters).length;
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState({
        availableDefinitions: tools,
        totalCount: 2,
        availableCount: 2,
      }),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.tools.schemaChars).toBe(expected);
    expect(out.report.tools.totalCount).toBe(2);
    expect(out.report.tools.availableCount).toBe(2);
    expect(out.report.tools.listChars).toBeGreaterThan(0);
  });

  it("missing tool parameters JSON-stringify as '{}' (length 2 each)", () => {
    const tools = [
      { name: "t1", description: "d" },
      { name: "t2", description: "d" },
    ] as unknown as IOpenclawRuntimeToolState["availableDefinitions"];
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "",
      skillState: mkSkillState(),
      toolState: mkToolState({ availableDefinitions: tools }),
      runtimeInfo: mkRuntimeInfo(),
    });
    expect(out.report.tools.schemaChars).toBe(4);
  });
});

describe("buildOpenclawPromptArtifacts — workspace char accounting", () => {
  it("projectContextChars + nonProjectContextChars === systemPrompt.chars", () => {
    const out = buildOpenclawPromptArtifacts({
      source: "run",
      bootstrapFiles: [{ name: "AGENTS.md", content: "hello world" }],
      bootstrapReport: mkBootstrapReport(),
      workspaceDigest: "demo workspace digest",
      skillState: mkSkillState(),
      toolState: mkToolState(),
      runtimeInfo: mkRuntimeInfo(),
    });
    const sp = out.report.systemPrompt;
    expect(sp.projectContextChars + sp.nonProjectContextChars).toBe(sp.chars);
    expect(sp.nonProjectContextChars).toBeGreaterThanOrEqual(0);
  });
});
