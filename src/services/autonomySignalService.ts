// autonomySignalService.ts — the app-wide bus for "autonomy signals".
//
// A signal is something an extension or background process noticed in the data
// it processes and wants the heartbeat to be aware of (a budget exceeded, a sync
// failed, a feed updated). Extensions publish via `api.autonomy.signal(...)` or
// the `parallx.autonomy.signal` command; the chat extension forwards each
// accepted signal onto the heartbeat's review queue. This is the first-class
// realization of OpenClaw's per-extension `system-events`: the app's subsystems
// are the heartbeat's senses.
//
// Pure normalize + a tiny event service so the contract is testable and the
// wiring (heartbeat sink) stays in chat/main.ts.

import { createServiceIdentifier } from '../platform/types.js';
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';

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

function coerceString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * Validate + coerce a raw payload into an IAutonomySignal. Returns null when
 * there's nothing meaningful to surface (no title), so a malformed call from a
 * third-party extension can never crash or spam the heartbeat.
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

export interface IAutonomySignalService {
  /** Publish a raw signal payload. Returns true if accepted, false if dropped (malformed). */
  signal(raw: unknown): boolean;
  /** Fires once per accepted signal. */
  readonly onDidSignal: Event<IAutonomySignal>;
}

export const IAutonomySignalService = createServiceIdentifier<IAutonomySignalService>('IAutonomySignalService');

export class AutonomySignalService extends Disposable implements IAutonomySignalService {
  private readonly _onDidSignal = this._register(new Emitter<IAutonomySignal>());
  readonly onDidSignal: Event<IAutonomySignal> = this._onDidSignal.event;

  signal(raw: unknown): boolean {
    const sig = normalizeAutonomySignal(raw);
    if (!sig) return false;
    this._onDidSignal.fire(sig);
    return true;
  }
}
