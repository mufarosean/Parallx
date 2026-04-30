// autonomyReplayCommand.ts — M60 §3.10 dev-only `autonomy:replay` command
//
// Stub implementation per M60 Phase α dispatch. Reads an autonomy event
// record by id, summarizes what it would replay, and emits its own
// `replay`-trigger autonomy event to record the invocation.
//
// Read-only by default — mutating tools are dry-run unless `--apply` is
// passed. Full reconstruction of system prompt + tool sequence is deferred
// to T5 (E3 Replay command in M60 §15.5); the stub demonstrates the wire
// and gives downstream work a stable command id to call.
//
// TODO(M60 T5.E3): full replay — rebuild system prompt from
// systemPromptHash provenance, replay toolCalls in dry-run mode (or live
// when `--apply`), and stream the reconstructed turn into the rail.

import type { IAutonomyEventLog, IAutonomyEventRecord } from '../services/autonomyEventLog.js';

export interface IAutonomyReplayResult {
  readonly ok: boolean;
  readonly eventId: string;
  readonly summary: string;
  readonly applied: boolean;
  readonly record?: IAutonomyEventRecord;
}

/**
 * Resolve and "replay" (stub) an autonomy event. Side effects:
 *   - emits a `replay`-kind autonomy event recording the invocation,
 *   - returns a structured result for the caller to render or assert in tests.
 */
export async function executeAutonomyReplay(
  log: IAutonomyEventLog | undefined,
  eventId: string,
  options?: { readonly apply?: boolean },
): Promise<IAutonomyReplayResult> {
  const apply = options?.apply === true;
  if (!log) {
    return {
      ok: false,
      eventId,
      summary: 'autonomy event log is unavailable',
      applied: false,
    };
  }
  const record = await log.findById(eventId);
  if (!record) {
    log.emit({
      trigger: { kind: 'replay', ref: eventId },
      outcome: 'error',
      note: 'replay-target-not-found',
    });
    return {
      ok: false,
      eventId,
      summary: `replay ${eventId}: event not found in retention window`,
      applied: false,
    };
  }
  const toolCount = record.toolCalls?.length ?? 0;
  const surfaceCount = record.surfaceRoutes?.length ?? 0;
  const summary = apply
    ? `replay ${eventId}: APPLY mode is not implemented in M60 Phase α (stub) — would replay ${toolCount} tool call(s) and ${surfaceCount} surface route(s).`
    : `replay ${eventId}: would replay ${toolCount} tool call(s) and ${surfaceCount} surface route(s); pass --apply to execute (stub — no-op in M60 Phase α).`;
  log.emit({
    trigger: { kind: 'replay', ref: eventId },
    outcome: apply ? 'error' : 'completed',
    note: apply ? 'replay --apply not implemented in M60 Phase α' : 'dry-run replay (stub)',
    surfaceRoutes: record.surfaceRoutes,
  });
  return {
    ok: true,
    eventId,
    summary,
    applied: false,
    record,
  };
}
