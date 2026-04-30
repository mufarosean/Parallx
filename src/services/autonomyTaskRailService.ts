// autonomyTaskRailService.ts — M60 Phase ζ §8 T5.E1
//
// Read-only viewmodel that merges the two existing autonomy data sources
// into a single rail feed:
//   - `AutonomyLogService` (in-memory, markdown bodies — the "live" stream)
//   - `AutonomyEventLog` (ndjson, structured records — the "history")
//
// The rail UI in `src/built-in/autonomy-log/main.ts` consumes this service
// instead of reading either source directly. Live entries appear with rich
// markdown bodies; historical entries (older than the in-memory window or
// from triggers without a body — followup, surface, replay) appear with
// trigger metadata only.
//
// Filter dimensions (E1):
//   - Trigger kinds: chat / heartbeat / cron / followup / sub-agent / replay
//   - Outcomes: completed / cancelled / budget / gated / error / deferred
//   - Time window: today / last 7 days / last 30 days / 90 days
//
// Pagination: cursor by day key, walking back from `today` to `today − 90d`.
// Default page size: 50.
//
// Privacy (§3.9): bodies live only in `AutonomyLogService` (in-memory ring
// buffer). The persisted ndjson never carries bodies; this service does
// not synthesize bodies from history.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IAutonomyEventLog, IAutonomyEventRecord, AutonomyTriggerKind, AutonomyOutcome } from './autonomyEventLog.js';
import type { IAutonomyLogEntry, IAutonomyLogReader } from './autonomyLogService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Unified rail row. `kind: 'live'` rows carry markdown content; `kind: 'event'`
 * rows are structured metadata only (no body).
 */
export type IRailRow =
  | {
      readonly kind: 'live';
      readonly id: string;
      readonly triggeredAt: string;
      readonly trigger: AutonomyTriggerKind | 'agent';
      readonly outcome?: AutonomyOutcome;
      readonly durationMs?: number;
      readonly tokensIn?: number;
      readonly tokensOut?: number;
      readonly content: string;
      readonly requestText: string;
      readonly read: boolean;
      readonly liveEntry: IAutonomyLogEntry;
    }
  | {
      readonly kind: 'event';
      readonly id: string;
      readonly triggeredAt: string;
      readonly trigger: AutonomyTriggerKind;
      readonly outcome: AutonomyOutcome;
      readonly durationMs?: number;
      readonly tokensIn?: number;
      readonly tokensOut?: number;
      readonly note?: string;
      readonly record: IAutonomyEventRecord;
    };

export interface IRailFilter {
  /** Trigger kinds to include. Empty array = no rows; undefined = all. */
  readonly triggers?: readonly (AutonomyTriggerKind | 'agent')[];
  /** Outcomes to include. Undefined = all. */
  readonly outcomes?: readonly AutonomyOutcome[];
  /** Look-back window in days (1–90). Default 7. */
  readonly sinceDays?: number;
  /** Max rows. Default 50. */
  readonly limit?: number;
}

export interface IAutonomyTaskRailService {
  /** Live + history rows, newest-first, filtered. */
  readRows(filter?: IRailFilter): Promise<readonly IRailRow[]>;
  /** In-memory rows only (cheap, sync — used for the "live" tail). */
  readLiveRows(filter?: IRailFilter): readonly IRailRow[];
  /** Fired when either source changes (in-memory append OR event emit). */
  readonly onDidChange: Event<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const DEFAULT_SINCE_DAYS = 7;
const MAX_SINCE_DAYS = 90;

function isoDay(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Map a live entry origin to the unified trigger kind. */
function liveOriginToTrigger(origin: string): AutonomyTriggerKind | 'agent' {
  switch (origin) {
    case 'heartbeat': return 'heartbeat';
    case 'cron': return 'cron';
    case 'subagent': return 'subagent';
    case 'agent': return 'agent';
    default: return 'chat';
  }
}

export class AutonomyTaskRailService extends Disposable implements IAutonomyTaskRailService {
  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(
    private readonly _live: IAutonomyLogReader & { onDidChange: Event<void> },
    private readonly _history: IAutonomyEventLog | undefined,
    private readonly _now: () => number = () => Date.now(),
  ) {
    super();
    this._register(this._live.onDidChange(() => this._onDidChange.fire()));
    if (this._history) {
      this._register(this._history.onDidEmit(() => this._onDidChange.fire()));
    }
  }

  readLiveRows(filter?: IRailFilter): readonly IRailRow[] {
    const limit = filter?.limit ?? DEFAULT_LIMIT;
    const triggers = filter?.triggers;
    const outcomes = filter?.outcomes;
    const live = this._live.getEntries({ limit: Math.max(limit * 2, 50) });
    const out: IRailRow[] = [];
    for (const e of live) {
      const trig = liveOriginToTrigger(e.origin);
      if (triggers && !triggers.includes(trig)) continue;
      // Live entries don't carry outcome — include only when no outcome filter.
      if (outcomes && outcomes.length > 0) continue;
      out.push({
        kind: 'live',
        id: e.id,
        triggeredAt: new Date(e.timestamp).toISOString(),
        trigger: trig,
        content: e.content,
        requestText: e.requestText,
        read: e.read,
        liveEntry: e,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async readRows(filter?: IRailFilter): Promise<readonly IRailRow[]> {
    const limit = filter?.limit ?? DEFAULT_LIMIT;
    const sinceDays = Math.min(MAX_SINCE_DAYS, Math.max(1, filter?.sinceDays ?? DEFAULT_SINCE_DAYS));
    const triggers = filter?.triggers;
    const outcomes = filter?.outcomes;

    const liveRows = this.readLiveRows({ ...filter, limit });

    // Walk back day-by-day reading ndjson.
    const eventRows: IRailRow[] = [];
    if (this._history) {
      const dayMs = 24 * 60 * 60 * 1000;
      const now = this._now();
      const seenIds = new Set<string>();
      for (let i = 0; i < sinceDays && eventRows.length < limit * 2; i++) {
        const dayKey = isoDay(new Date(now - i * dayMs));
        let records: readonly IAutonomyEventRecord[] = [];
        try {
          records = await this._history.readDay(dayKey);
        } catch {
          records = [];
        }
        // Records inside a daily file are written in append order — reverse
        // so we walk newest-first within the day.
        for (let j = records.length - 1; j >= 0; j--) {
          const r = records[j];
          if (seenIds.has(r.id)) continue;
          seenIds.add(r.id);
          if (triggers && !triggers.includes(r.trigger.kind)) continue;
          if (outcomes && outcomes.length > 0 && !outcomes.includes(r.outcome)) continue;
          eventRows.push({
            kind: 'event',
            id: r.id,
            triggeredAt: r.triggeredAt,
            trigger: r.trigger.kind,
            outcome: r.outcome,
            durationMs: r.durationMs,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            note: r.note,
            record: r,
          });
        }
      }
    }

    // Merge — live rows first (they're usually newer), then events. Stable
    // sort by triggeredAt descending. Cap to limit.
    const merged: IRailRow[] = [...liveRows, ...eventRows];
    merged.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
    return merged.slice(0, limit);
  }
}
