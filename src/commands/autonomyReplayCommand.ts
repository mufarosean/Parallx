// autonomyReplayCommand.ts — dev-only `autonomy.replay` command (M60 §3.10).
//
// Inspects a past autonomy event by id: summarizes what it did (its recorded
// tool calls and surface routes) and logs the inspection as a `replay`-trigger
// event. This is a read-only INSPECTOR — it never re-executes anything. Live
// re-execution of a past autonomous turn is deliberately NOT offered: replaying
// real tool calls and surface routes is dangerous and out of scope.

import type { IAutonomyEventLog, IAutonomyEventRecord } from '../services/autonomyEventLog.js';

export interface IAutonomyReplayResult {
  readonly ok: boolean;
  readonly eventId: string;
  readonly summary: string;
  readonly record?: IAutonomyEventRecord;
}

/**
 * Resolve and inspect a past autonomy event. Side effects:
 *   - emits a `replay`-kind autonomy event recording the inspection,
 *   - returns a structured result for the caller to render or assert in tests.
 */
export async function executeAutonomyReplay(
  log: IAutonomyEventLog | undefined,
  eventId: string,
): Promise<IAutonomyReplayResult> {
  if (!log) {
    return { ok: false, eventId, summary: 'autonomy event log is unavailable' };
  }
  const record = await log.findById(eventId);
  if (!record) {
    log.emit({
      trigger: { kind: 'replay', ref: eventId },
      outcome: 'error',
      note: 'replay-target-not-found',
    });
    return { ok: false, eventId, summary: `replay ${eventId}: event not found in retention window` };
  }
  const toolCount = record.toolCalls?.length ?? 0;
  const surfaceCount = record.surfaceRoutes?.length ?? 0;
  log.emit({
    trigger: { kind: 'replay', ref: eventId },
    outcome: 'completed',
    note: 'autonomy event inspected',
    surfaceRoutes: record.surfaceRoutes,
  });
  return {
    ok: true,
    eventId,
    summary: `replay ${eventId}: this event ran ${toolCount} tool call(s) and ${surfaceCount} surface route(s). Inspection only — nothing is re-executed.`,
    record,
  };
}
