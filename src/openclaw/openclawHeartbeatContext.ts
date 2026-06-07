// openclawHeartbeatContext.ts — assembles the app-wide "situational snapshot"
// the heartbeat hands the model on each review.
//
// This is what turns the heartbeat from a file-change reflex into the app's
// awareness loop: instead of "a .ts file changed," the model is told the state
// of the whole app — which background diagnostics are failing, what activity
// happened since the last review — so it can decide whether anything actually
// needs the user's attention. Senses are additive; Phase 1 wires diagnostics +
// workspace activity, later phases add tasks/planner/canvas/extension signals.
//
// Pure by design (snapshot + formatting are testable without a running app);
// the executor supplies the live inputs.

import type { IDiagnosticResult } from '../services/serviceTypes.js';
import type { IHeartbeatSystemEvent } from './openclawHeartbeatRunner.js';

/** A compact, model-facing view of app state at review time. */
export interface IHeartbeatAppSnapshot {
  /** Whether diagnostics were available to read at all. */
  readonly diagnosticsAvailable: boolean;
  /** Total diagnostic checks seen (any status). */
  readonly diagnosticsTotal: number;
  /** Only the checks that need attention (warn/fail), worst-first. */
  readonly diagnosticsAttention: readonly {
    readonly name: string;
    readonly status: 'warn' | 'fail';
    readonly detail: string;
    readonly category?: string;
  }[];
  /** Pending workspace events since the last review, grouped by type. */
  readonly events: readonly { readonly type: string; readonly count: number }[];
  /** Total pending events across all types. */
  readonly eventCount: number;
}

/** Build the snapshot from the live inputs. Pure. */
export function buildHeartbeatSnapshot(
  diagnostics: readonly IDiagnosticResult[] | undefined,
  events: readonly IHeartbeatSystemEvent[],
): IHeartbeatAppSnapshot {
  const diagnosticsAvailable = Array.isArray(diagnostics);
  const attention = (diagnostics ?? [])
    .filter((d): d is IDiagnosticResult & { status: 'warn' | 'fail' } =>
      d.status === 'warn' || d.status === 'fail')
    .map(d => ({ name: d.name, status: d.status, detail: d.detail, category: d.category }))
    // fail before warn
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));

  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

  return {
    diagnosticsAvailable,
    diagnosticsTotal: diagnostics?.length ?? 0,
    diagnosticsAttention: attention,
    events: [...byType.entries()].map(([type, count]) => ({ type, count })),
    eventCount: events.length,
  };
}

/** True when the snapshot contains anything worth the model's attention. */
export function hasNoteworthySignals(s: IHeartbeatAppSnapshot): boolean {
  return s.diagnosticsAttention.length > 0 || s.eventCount > 0;
}

/**
 * Render the snapshot as a compact block for the heartbeat seed. Kept terse —
 * the model gets state, not prose. Always communicates the diagnostics posture
 * (even "all clear") so the model can confidently report nothing-to-do.
 */
export function formatAppContext(s: IHeartbeatAppSnapshot): string {
  const lines: string[] = ['Workspace status snapshot:'];

  if (!s.diagnosticsAvailable) {
    lines.push('- Diagnostics: unavailable this tick.');
  } else if (s.diagnosticsAttention.length === 0) {
    lines.push(`- Diagnostics: all ${s.diagnosticsTotal} checks passing.`);
  } else {
    lines.push(`- Diagnostics: ${s.diagnosticsAttention.length} need attention —`);
    for (const d of s.diagnosticsAttention) {
      lines.push(`    [${d.status.toUpperCase()}] ${d.name}: ${d.detail}`);
    }
  }

  if (s.eventCount === 0) {
    lines.push('- Recent activity: none since the last review.');
  } else {
    const parts = s.events.map(e => `${e.count} ${e.type}`).join(', ');
    lines.push(`- Recent activity: ${parts}.`);
  }

  return lines.join('\n');
}
