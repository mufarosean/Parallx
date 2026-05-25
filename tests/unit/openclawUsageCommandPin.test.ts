/**
 * Pin: tryHandleOpenclawUsageCommand — /usage slash-command handler.
 * Has two paths: observability-service path (D7) and history-aggregation
 * fallback (pre-D7).  Locks the command gate, both render paths, the
 * formatDuration thresholds, and the model-performance section.
 */
import { describe, it, expect } from "vitest";
import { tryHandleOpenclawUsageCommand } from "../../src/openclaw/commands/openclawUsageCommand";

function makeResponse() {
  const calls: string[] = [];
  return {
    calls,
    markdown(text: string) { calls.push(text); },
  } as any;
}

describe("tryHandleOpenclawUsageCommand", () => {
  it("returns false for non-'usage' command without side effects", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawUsageCommand({} as any, "status", {} as any, r)).toBe(false);
    expect(await tryHandleOpenclawUsageCommand({} as any, undefined, {} as any, r)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  // ── Fallback (history) path ───────────────────────────────────────────────

  it("fallback: empty history emits 'No turns completed yet'", async () => {
    const r = makeResponse();
    const services: any = { getActiveModel: () => "llama3:8b", getModelContextLength: () => 8192 };
    await tryHandleOpenclawUsageCommand(services, "usage", { history: [] } as any, r);
    const md = r.calls[0]!;
    expect(md).toContain("## Session Token Usage");
    expect(md).toContain("**Model:** llama3:8b");
    expect(md).toContain("**Context Window:** 8K tokens");
    expect(md).toContain("| Turns | 0 |");
    expect(md).toContain("No turns completed yet in this session.");
  });

  it("fallback: aggregates promptTokens + completionTokens across history entries", async () => {
    const r = makeResponse();
    const services: any = { getActiveModel: () => "llama3:8b", getModelContextLength: () => 8192 };
    const context: any = {
      history: [
        { response: { promptTokens: 100, completionTokens: 50 } },
        { response: { promptTokens: 200, completionTokens: 75 } },
        { request: "no response key" },
      ],
    };
    await tryHandleOpenclawUsageCommand(services, "usage", context, r);
    const md = r.calls[0]!;
    expect(md).toContain("| Turns | 2 |");
    expect(md).toContain("| Prompt Tokens | 300 |");
    expect(md).toContain("| Completion Tokens | 125 |");
    expect(md).toContain("| **Total Tokens** | **425** |");
    // 425 / 8192 ≈ 5.2%
    expect(md).toContain("| Context Usage | 5.2% of 8K |");
    expect(md).toContain("*Average: 150 prompt + 63 completion per turn*"); // 125/2=62.5 → 63
  });

  it("fallback: omits Context Usage row when contextLength is 0", async () => {
    const r = makeResponse();
    const services: any = { getActiveModel: () => "llama3:8b", getModelContextLength: () => 0 };
    await tryHandleOpenclawUsageCommand(services, "usage", { history: [{ response: { promptTokens: 10, completionTokens: 5 } }] } as any, r);
    expect(r.calls[0]).not.toContain("Context Usage");
    expect(r.calls[0]).not.toContain("Context Window");
  });

  it("fallback: missing context.history is treated as zero turns", async () => {
    const r = makeResponse();
    const services: any = { getActiveModel: () => "llama3:8b" };
    await tryHandleOpenclawUsageCommand(services, "usage", {} as any, r);
    expect(r.calls[0]).toContain("| Turns | 0 |");
  });

  // ── Observability service (D7) path ──────────────────────────────────────

  it("observability path: renders session metrics with duration rows", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getModelContextLength: () => 8192,
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 3,
          totalPromptTokens: 500,
          totalCompletionTokens: 250,
          totalTokens: 750,
          totalDurationMs: 5500,
          avgDurationMs: 1833,
          avgPromptTokens: 166.6,
          avgCompletionTokens: 83.3,
        }),
        getModelMetrics: () => [
          { model: "llama3:8b", turnCount: 3, totalTokens: 750, avgDurationMs: 1833 },
        ],
      },
    };
    await tryHandleOpenclawUsageCommand(services, "usage", {} as any, r);
    const md = r.calls[0]!;
    expect(md).toContain("## Session Token Usage");
    expect(md).toContain("| Turns | 3 |");
    expect(md).toContain("| Prompt Tokens | 500 |");
    expect(md).toContain("| **Total Tokens** | **750** |");
    expect(md).toContain("Total Duration | 5.5s");
    expect(md).toContain("Avg Turn Duration | 1.8s");
    expect(md).toContain("*Average: 167 prompt + 83 completion per turn*");
    // Single model — no Model Performance section
    expect(md).not.toContain("### Model Performance");
  });

  it("observability path: renders Model Performance section when more than one model used", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getModelContextLength: () => 0,
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 2,
          totalPromptTokens: 100,
          totalCompletionTokens: 50,
          totalTokens: 150,
          totalDurationMs: 80000,
          avgDurationMs: 40000,
          avgPromptTokens: 50,
          avgCompletionTokens: 25,
        }),
        getModelMetrics: () => [
          { model: "llama3:8b", turnCount: 1, totalTokens: 100, avgDurationMs: 500 },
          { model: "qwen2:7b", turnCount: 1, totalTokens: 50, avgDurationMs: 65000 },
        ],
      },
    };
    await tryHandleOpenclawUsageCommand(services, "usage", {} as any, r);
    const md = r.calls[0]!;
    expect(md).toContain("### Model Performance");
    expect(md).toContain("| Model | Turns | Tokens | Avg Duration |");
    expect(md).toContain("| llama3:8b | 1 | 100 | 500ms |"); // <1000ms branch
    expect(md).toContain("| qwen2:7b | 1 | 50 | 1.1m |"); // >=60000ms branch
    // avgDurationMs=40000 → 40.0s for session row
    expect(md).toContain("Total Duration | 1.3m");
    expect(md).toContain("Avg Turn Duration | 40.0s");
  });

  it("observability path: zero turns emits 'No turns completed yet' tail", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getModelContextLength: () => 0,
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0,
          totalDurationMs: 0, avgDurationMs: 0, avgPromptTokens: 0, avgCompletionTokens: 0,
        }),
        getModelMetrics: () => [],
      },
    };
    await tryHandleOpenclawUsageCommand(services, "usage", {} as any, r);
    expect(r.calls[0]).toContain("No turns completed yet in this session.");
  });
});
