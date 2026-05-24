/**
 * Pin tests for openclaw /doctor and /usage command handlers.
 *
 * Pins (/doctor):
 *   - Returns false unless command === "doctor".
 *   - Delegates to services.diagnosticsService when present; otherwise runs inline checks.
 *   - Renders summary line "X pass, Y fail, Z warn".
 *   - Recommended Actions section appears only when at least one check failed.
 *
 * Pins (/usage):
 *   - Returns false unless command === "usage".
 *   - Prefers services.observabilityService when present; otherwise aggregates from context history.
 *   - Renders the "Session Token Usage" header and the Total Tokens row.
 *   - Model Performance section appears only when multiple model metrics present.
 */
import { describe, it, expect } from "vitest";
import { tryHandleOpenclawDoctorCommand } from "../../src/openclaw/commands/openclawDoctorCommand";
import { tryHandleOpenclawUsageCommand } from "../../src/openclaw/commands/openclawUsageCommand";

function makeStream() {
  const chunks: string[] = [];
  const progress: string[] = [];
  return {
    chunks, progress,
    stream: {
      markdown: (s: string) => { chunks.push(s); },
      progress: (s: string) => { progress.push(s); },
    } as any,
  };
}

describe("openclaw /doctor", () => {
  it("returns false when command !== 'doctor'", async () => {
    const a = makeStream();
    expect(await tryHandleOpenclawDoctorCommand({} as any, "status", a.stream)).toBe(false);
  });

  it("delegates to services.diagnosticsService when present", async () => {
    const a = makeStream();
    let called = false;
    const services = {
      diagnosticsService: {
        runChecks: async () => {
          called = true;
          return [
            { name: "C1", status: "pass", detail: "ok", timestamp: 0, category: "x" },
            { name: "C2", status: "warn", detail: "meh", timestamp: 0, category: "x" },
          ];
        },
      },
    } as any;
    expect(await tryHandleOpenclawDoctorCommand(services, "doctor", a.stream)).toBe(true);
    expect(called).toBe(true);
    expect(a.progress[0]).toContain("Running diagnostics");
    const md = a.chunks[0];
    expect(md).toContain("## Diagnostic Report");
    expect(md).toContain("**1** pass, **0** fail, **1** warn");
    expect(md).not.toContain("### Recommended Actions");
  });

  it("renders Recommended Actions only when a check fails", async () => {
    const a = makeStream();
    const services = {
      diagnosticsService: {
        runChecks: async () => [
          { name: "C1", status: "fail", detail: "broken", timestamp: 0, category: "x" },
        ],
      },
    } as any;
    expect(await tryHandleOpenclawDoctorCommand(services, "doctor", a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("**0** pass, **1** fail");
    expect(md).toContain("### Recommended Actions");
    expect(md).toContain("- **C1:** broken");
  });

  it("runs inline checks when no diagnosticsService is wired", async () => {
    const a = makeStream();
    const services = {
      checkProviderStatus: async () => ({ available: true, version: "9.9" } as any),
      getActiveModel: () => "m",
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getFileCount: async () => 5,
      getWorkspaceName: () => "wsp",
      getModelContextLength: () => 8192,
    } as any;
    expect(await tryHandleOpenclawDoctorCommand(services, "doctor", a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Diagnostic Report");
    expect(md).toContain("Ollama Connection");
    expect(md).toContain("Active Model");
    expect(md).toContain("File Index");
  });
});

describe("openclaw /usage", () => {
  it("returns false when command !== 'usage'", async () => {
    const a = makeStream();
    expect(await tryHandleOpenclawUsageCommand({} as any, "doctor", {} as any, a.stream)).toBe(false);
  });

  it("prefers observabilityService and renders single-model summary", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "phi",
      getModelContextLength: () => 4096,
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 3, totalPromptTokens: 100, totalCompletionTokens: 50,
          totalTokens: 150, totalDurationMs: 2500, avgDurationMs: 833,
          avgPromptTokens: 33, avgCompletionTokens: 17,
        }),
        getModelMetrics: () => [
          { model: "phi", turnCount: 3, totalTokens: 150, avgDurationMs: 833 },
        ],
      },
    } as any;
    expect(await tryHandleOpenclawUsageCommand(services, "usage", {} as any, a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Session Token Usage");
    expect(md).toContain("**Model:** phi");
    expect(md).toContain("Total Tokens");
    expect(md).toContain("150");
    expect(md).not.toContain("### Model Performance"); // only 1 model
  });

  it("renders Model Performance when multiple models present", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "phi",
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 2, totalPromptTokens: 10, totalCompletionTokens: 5,
          totalTokens: 15, totalDurationMs: 100, avgDurationMs: 50,
          avgPromptTokens: 5, avgCompletionTokens: 2.5,
        }),
        getModelMetrics: () => [
          { model: "phi", turnCount: 1, totalTokens: 7, avgDurationMs: 60 },
          { model: "llama", turnCount: 1, totalTokens: 8, avgDurationMs: 40 },
        ],
      },
    } as any;
    expect(await tryHandleOpenclawUsageCommand(services, "usage", {} as any, a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("### Model Performance");
    expect(md).toContain("phi");
    expect(md).toContain("llama");
  });

  it("falls back to aggregating from history when observabilityService is absent", async () => {
    const a = makeStream();
    const services = { getActiveModel: () => "m" } as any;
    const ctx = {
      history: [
        { response: { promptTokens: 10, completionTokens: 5 } },
        { response: { promptTokens: 20, completionTokens: 15 } },
      ],
    } as any;
    expect(await tryHandleOpenclawUsageCommand(services, "usage", ctx, a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Session Token Usage");
    expect(md).toContain("| Turns | 2 |");
    expect(md).toContain("50"); // total tokens
  });

  it("renders empty-session footer when no turns are available", async () => {
    const a = makeStream();
    const services = { getActiveModel: () => "m" } as any;
    expect(await tryHandleOpenclawUsageCommand(services, "usage", { history: [] } as any, a.stream)).toBe(true);
    expect(a.chunks[0]).toContain("No turns completed yet");
  });
});
