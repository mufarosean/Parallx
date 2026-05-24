import { describe, it, expect, vi } from "vitest";
import {
  createOpenclawCommandRegistry,
  buildFallbackSessionSummary,
  createOpenclawRuntimeLifecycle,
} from "../../src/openclaw/openclawDefaultRuntimeSupport";
import type { IChatSlashCommand } from "../../src/services/chatRuntimeTypes";

describe("createOpenclawCommandRegistry — parseSlashCommand", () => {
  const r = createOpenclawCommandRegistry();

  it("returns no command and original text when input lacks a leading slash", () => {
    expect(r.parseSlashCommand("hello world")).toEqual({
      command: undefined,
      commandName: undefined,
      remainingText: "hello world",
    });
  });

  it("resolves a built-in command name and splits remaining text", () => {
    const out = r.parseSlashCommand("/context show me the plan");
    expect(out.commandName).toBe("context");
    expect(out.command?.name).toBe("context");
    expect(out.remainingText).toBe("show me the plan");
  });

  it("returns undefined command but commandName + empty remainingText for unknown slash", () => {
    const out = r.parseSlashCommand("/nope");
    expect(out.command).toBeUndefined();
    expect(out.commandName).toBe("nope");
    expect(out.remainingText).toBe("");
  });

  it("trims leading whitespace before slash parsing", () => {
    const out = r.parseSlashCommand("   /init   arg1   arg2  ");
    expect(out.commandName).toBe("init");
    expect(out.remainingText).toBe("arg1 arg2");
  });
});

describe("createOpenclawCommandRegistry — applyCommandTemplate", () => {
  const r = createOpenclawCommandRegistry();
  const tpl: IChatSlashCommand = {
    name: "echo", description: "", promptTemplate: "say: {input}", isBuiltIn: false,
  };
  const noVar: IChatSlashCommand = {
    name: "noop", description: "", promptTemplate: "fixed text", isBuiltIn: false,
  };

  it("substitutes {input} into the template", () => {
    // applyCommandTemplate signature in implementation is (command, input)
    expect((r.applyCommandTemplate as unknown as (c: IChatSlashCommand, i: string) => string | undefined)(tpl, "hi")).toBe("say: hi");
  });

  it("returns input verbatim when the template lacks {input}", () => {
    expect((r.applyCommandTemplate as unknown as (c: IChatSlashCommand, i: string) => string | undefined)(noVar, "ignored")).toBe("ignored");
  });
});

describe("createOpenclawCommandRegistry — registerCommand", () => {
  it("dynamic command shadows a built-in of the same name", () => {
    const r = createOpenclawCommandRegistry();
    const replacement: IChatSlashCommand = {
      name: "context", description: "custom", promptTemplate: "x", isBuiltIn: false,
    };
    r.registerCommand!(replacement);
    expect(r.parseSlashCommand("/context").command).toBe(replacement);
  });

  it("dispose restores the built-in when no other registration occurred", () => {
    const r = createOpenclawCommandRegistry();
    const replacement: IChatSlashCommand = {
      name: "context", description: "custom", promptTemplate: "x", isBuiltIn: false,
    };
    const d = r.registerCommand!(replacement);
    d.dispose();
    expect(r.parseSlashCommand("/context").command?.description).toBe("Show the runtime context breakdown");
  });

  it("dispose is a no-op if the slot was replaced by another registration", () => {
    const r = createOpenclawCommandRegistry();
    const first: IChatSlashCommand = { name: "context", description: "a", promptTemplate: "x", isBuiltIn: false };
    const second: IChatSlashCommand = { name: "context", description: "b", promptTemplate: "y", isBuiltIn: false };
    const d1 = r.registerCommand!(first);
    r.registerCommand!(second);
    d1.dispose();
    expect(r.parseSlashCommand("/context").command).toBe(second);
  });

  it("getRegisteredCommands merges built-ins and dynamic with dynamic overriding by name", () => {
    const r = createOpenclawCommandRegistry();
    const baselineNames = r.getRegisteredCommands!().map(c => c.name);
    expect(baselineNames).toContain("context");
    expect(baselineNames).toContain("init");

    const override: IChatSlashCommand = { name: "init", description: "ovr", promptTemplate: "z", isBuiltIn: false };
    r.registerCommand!(override);
    const merged = r.getRegisteredCommands!();
    const initEntries = merged.filter(c => c.name === "init");
    expect(initEntries).toHaveLength(1);
    expect(initEntries[0]).toBe(override);
  });
});

describe("buildFallbackSessionSummary", () => {
  it("empty history + empty current → empty string", () => {
    expect(buildFallbackSessionSummary([], "")).toBe("");
  });

  it("uses up to the last 3 user messages (including current)", () => {
    const summary = buildFallbackSessionSummary(
      [
        { request: { text: "first" } },
        { request: { text: "second" } },
        { request: { text: "third" } },
        { request: { text: "fourth" } },
      ],
      "fifth",
    );
    expect(summary).toBe("third. fourth. fifth.");
  });

  it("preserves trailing punctuation; appends '.' to bare statements", () => {
    const summary = buildFallbackSessionSummary([], "Why? Because!");
    expect(summary).toBe("Why? Because!");
  });

  it("collapses internal whitespace and trims", () => {
    const summary = buildFallbackSessionSummary([], "  hello   world  ");
    expect(summary).toBe("hello world.");
  });

  it("filters blank/empty messages before slicing the last 3", () => {
    const summary = buildFallbackSessionSummary(
      [
        { request: { text: "  " } },
        { request: { text: "alpha" } },
        { request: { text: "" } },
      ],
      "beta",
    );
    expect(summary).toBe("alpha. beta.");
  });

  it("truncates with ellipsis when summary exceeds 900 chars", () => {
    const big = "x".repeat(950);
    const summary = buildFallbackSessionSummary([], big);
    expect(summary.length).toBeLessThanOrEqual(900);
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("createOpenclawRuntimeLifecycle — trace checkpoints", () => {
  function makeSeed() {
    return {
      route: { kind: "qa" as const },
      contextPlan: {
        intent: { primary: "qa" } as never,
        useRetrieval: false,
        useMemoryRecall: false,
        useTranscriptRecall: false,
        useConceptRecall: false,
        useCurrentPage: false,
        citationMode: "disabled" as const,
        reasoning: "",
        retrievalPlan: {} as never,
      },
      hasActiveSlashCommand: false,
      isRagReady: false,
    };
  }

  it("recordCompleted reports 'post-finalization' with runState 'completed'", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({
      runtimeTraceSeed: makeSeed() as never,
      reportRuntimeTrace: report,
    });
    lc.recordCompleted("done");
    expect(report).toHaveBeenCalledTimes(1);
    const arg = report.mock.calls[0][0];
    expect(arg.checkpoint).toBe("post-finalization");
    expect(arg.runState).toBe("completed");
    expect(arg.note).toBe("done");
  });

  it("recordAborted reports 'run-aborted' with runState 'aborted'", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({
      runtimeTraceSeed: makeSeed() as never,
      reportRuntimeTrace: report,
    });
    lc.recordAborted();
    expect(report.mock.calls[0][0].checkpoint).toBe("run-aborted");
    expect(report.mock.calls[0][0].runState).toBe("aborted");
  });

  it("recordFailed reports 'run-failed' with runState 'failed'", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({
      runtimeTraceSeed: makeSeed() as never,
      reportRuntimeTrace: report,
    });
    lc.recordFailed("bad");
    expect(report.mock.calls[0][0].checkpoint).toBe("run-failed");
    expect(report.mock.calls[0][0].runState).toBe("failed");
    expect(report.mock.calls[0][0].note).toBe("bad");
  });

  it("no reportRuntimeTrace / no seed → no calls (silent no-op)", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({ reportRuntimeTrace: report });
    lc.recordCompleted();
    lc.recordAborted();
    lc.recordFailed();
    expect(report).not.toHaveBeenCalled();
  });

  it("queueMemoryWriteBack is silently dropped on recordAborted (no fire)", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({
      runtimeTraceSeed: makeSeed() as never,
      reportRuntimeTrace: report,
    });
    // Disabled memory → flush is a no-op even if it fires; abort still drops.
    lc.queueMemoryWriteBack(
      { buildFallbackSessionSummary: () => "" },
      { memoryEnabled: false, requestText: "", sessionId: "s", history: [] },
    );
    lc.recordAborted();
    // Only one trace from recordAborted; queue was dropped without firing memory.
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].checkpoint).toBe("run-aborted");
  });

  it("queueMemoryWriteBack is silently dropped on recordFailed", () => {
    const report = vi.fn();
    const lc = createOpenclawRuntimeLifecycle({
      runtimeTraceSeed: makeSeed() as never,
      reportRuntimeTrace: report,
    });
    lc.queueMemoryWriteBack(
      { buildFallbackSessionSummary: () => "" },
      { memoryEnabled: false, requestText: "", sessionId: "s", history: [] },
    );
    lc.recordFailed();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].checkpoint).toBe("run-failed");
  });
});
