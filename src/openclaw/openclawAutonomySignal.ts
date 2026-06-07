// openclawAutonomySignal.ts — the extension → heartbeat signal channel.
//
// This is the keystone of "the heartbeat is the app's awareness loop": any
// extension or background process can publish a *signal* — something it noticed
// in the data it processes (a budget exceeded, a sync failed, a feed updated) —
// and the heartbeat folds it into its next review. It restores OpenClaw's
// per-extension `system-events` idea: the app's subsystems are the heartbeat's
// senses.
//
// Transport (Phase 3): extensions call the `parallx.autonomy.signal` command
// with a raw payload; the chat extension normalizes it here and pushes it onto
// the heartbeat's system-event queue. Pure + tested so the contract is stable
// even though the wiring lives in chat/main.ts.

import type { IHeartbeatSystemEvent } from './openclawHeartbeatRunner.js';

/** Rough importance of a signal — influences how the model treats it. */
export type AutonomySignalSeverity = 'info' | 'warn' | 'urgent';

/** A noteworthy thing an extension/subsystem wants the heartbeat to know about. */
export interface IAutonomySignal {
  /** Origin — the extension/tool id or subsystem name (e.g. "budget", "web-research"). */
  readonly source: string;
  /** Short machine-ish kind (e.g. "budget-exceeded", "sync-failed"). */
  readonly kind: string;
  /** One-line human summary shown to the model. Required. */
  readonly title: string;
  /** Optional longer detail. */
  readonly detail?: string;
  /** Importance. Defaults to "info". */
  readonly severity: AutonomySignalSeverity;
}

/** The system-event type used for extension signals on the heartbeat queue. */
export const AUTONOMY_SIGNAL_EVENT_TYPE = 'extension-signal';

function coerceString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * Validate + coerce a raw command payload into an IAutonomySignal. Returns null
 * when there's nothing meaningful to surface (no title), so a malformed call
 * from a third-party extension can never crash or spam the heartbeat.
 */
export function normalizeAutonomySignal(raw: unknown): IAutonomySignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = coerceString(r.title).trim();
  if (!title) return null;
  const severity = r.severity === 'urgent' || r.severity === 'warn' ? r.severity : 'info';
  const detail = coerceString(r.detail).trim();
  return {
    source: coerceString(r.source, 'extension').trim() || 'extension',
    kind: coerceString(r.kind, 'signal').trim() || 'signal',
    title: title.slice(0, 200),
    detail: detail ? detail.slice(0, 1000) : undefined,
    severity,
  };
}

/** Turn a normalized signal into a heartbeat system-event. */
export function signalToSystemEvent(sig: IAutonomySignal): IHeartbeatSystemEvent {
  return {
    type: AUTONOMY_SIGNAL_EVENT_TYPE,
    payload: {
      source: sig.source,
      kind: sig.kind,
      title: sig.title,
      ...(sig.detail ? { detail: sig.detail } : {}),
      severity: sig.severity,
    },
    timestamp: Date.now(),
  };
}
