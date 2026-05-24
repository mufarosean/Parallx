/**
 * Pin-the-invariant: commands/autonomyReplayCommand.ts stub semantics.
 * Replay never applies in M60 Phase α; emits exactly one autonomy event per call.
 */
import { describe, it, expect, vi } from "vitest";
import { executeAutonomyReplay } from "../../src/commands/autonomyReplayCommand";

function makeLog(record?: any) {
  const emitted: any[] = [];
  return {
    log: {
      findById: vi.fn().mockResolvedValue(record),
      emit: vi.fn((e: any) => emitted.push(e)),
    } as any,
    emitted,
  };
}

describe("executeAutonomyReplay", () => {
  it("returns ok=false when log is undefined", async () => {
    const r = await executeAutonomyReplay(undefined, "abc");
    expect(r).toEqual({
      ok: false,
      eventId: "abc",
      summary: "autonomy event log is unavailable",
      applied: false,
    });
  });

  it("returns ok=false when record is not found and emits replay/error event", async () => {
    const { log, emitted } = makeLog(undefined);
    const r = await executeAutonomyReplay(log, "missing");
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      trigger: { kind: "replay", ref: "missing" },
      outcome: "error",
      note: "replay-target-not-found",
    });
  });

  it("dry-run (no --apply): outcome=completed, applied=false, note=dry-run replay (stub)", async () => {
    const record = {
      toolCalls: [{}, {}],
      surfaceRoutes: [{ surface: "a" }],
    };
    const { log, emitted } = makeLog(record);
    const r = await executeAutonomyReplay(log, "e1");
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.record).toBe(record);
    expect(r.summary).toContain("would replay 2 tool call(s) and 1 surface route(s)");
    expect(emitted[0]).toMatchObject({
      trigger: { kind: "replay", ref: "e1" },
      outcome: "completed",
      note: "dry-run replay (stub)",
    });
    expect(emitted[0].surfaceRoutes).toBe(record.surfaceRoutes);
  });

  it("apply=true: applied still false, outcome=error, summary mentions APPLY", async () => {
    const record = { toolCalls: [], surfaceRoutes: [] };
    const { log, emitted } = makeLog(record);
    const r = await executeAutonomyReplay(log, "e2", { apply: true });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.summary).toContain("APPLY mode is not implemented");
    expect(emitted[0]).toMatchObject({
      outcome: "error",
      note: "replay --apply not implemented in M60 Phase α",
    });
  });

  it("treats missing toolCalls/surfaceRoutes as zero counts", async () => {
    const record = {} as any;
    const { log } = makeLog(record);
    const r = await executeAutonomyReplay(log, "e3");
    expect(r.summary).toContain("0 tool call(s)");
    expect(r.summary).toContain("0 surface route(s)");
  });
});
