// activityJournalService.ts — the app's common activity language.
//
// One append-only stream of human-readable events describing what happened in
// the app: "user opened pdf 'notes.pdf'", "user edited page 'Exam 7' (~240
// chars)", "assistant ran tool web_search". Every subsystem narrates through
// note(); three consumers read it:
//   1. The heartbeat/autonomy wake context (renderRecent) — the agent finally
//      sees what the user DID, not just which files changed.
//   2. Diagnostics — the last N lines are a ready-made "what led up to this".
//   3. The activity_log chat tool — the model can ask "what happened today?".
//
// Design rules:
//   • SEMANTIC events, never raw input. "edited page 'X' (~240 chars)" comes
//     from debounced save commits — the journal never sees keystrokes.
//   • Actor is first-class ('user' | 'ai' | 'system' | 'ext:<id>') so the
//     heartbeat can distinguish the user's work from its own — feeding an
//     agent a journal of its own actions labeled as the user's is how
//     self-echo loops start.
//   • Redact before store: the stream is destined for model prompts and (with
//     the user's per-workspace opt-in) cloud providers.
//   • Coalesce bursts: repeated identical events within a window merge into
//     one line with a ×N count, so focus flapping and typing cadence never
//     flood the store or the prompt.
//   • Best-effort persistence: an in-memory ring is the source of truth for
//     the session; SQLite (per-workspace app DB) is a batched, transactional
//     mirror with count-capped retention. A closed DB never blocks note().

import { createServiceIdentifier } from '../platform/types.js';
import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import type { IDatabaseService } from './serviceTypes.js';

export type ActivityActor = 'user' | 'ai' | 'system' | string; // or 'ext:<toolId>'

export interface IActivityEvent {
  readonly ts: number;
  readonly actor: ActivityActor;
  readonly verb: string;
  readonly object: string;
  readonly detail?: string;
  /** Which tap produced it ('command', 'editor', 'chat', 'ext:<id>', ...). */
  readonly source: string;
  /** Coalesced repeat count (≥ 1). */
  count: number;
}

export interface IActivityNote {
  readonly actor?: ActivityActor;
  readonly verb: string;
  readonly object: string;
  readonly detail?: string;
  readonly source?: string;
}

export interface IActivityJournalService {
  /** Append one event. Never throws; malformed notes are dropped. */
  note(n: IActivityNote): void;
  /** Last `n` events, oldest first. */
  tail(n: number): readonly IActivityEvent[];
  /** Human-readable narrative of recent events (for prompts/diagnostics). */
  renderRecent(opts?: { maxLines?: number; sinceMs?: number }): string;
  /** Query persisted history (falls back to the ring when the DB is closed). */
  query(opts?: { limit?: number; sinceTs?: number }): Promise<readonly IActivityEvent[]>;
  /** Drain pending rows to SQLite. Safe to call any time. */
  flush(): Promise<void>;
  /** Wire the per-workspace database (idempotent; re-arms on open/close). */
  attachDatabase(db: IDatabaseService): void;
  readonly onDidAppend: Event<IActivityEvent>;
}

export const IActivityJournalService =
  createServiceIdentifier<IActivityJournalService>('IActivityJournalService');

// ── Pure helpers (exported for tests) ───────────────────────────────────────

const SECRET_RE = /\b(api[_-]?key|token|secret|password|passwd|bearer|authorization)\b\s*[:=]?\s*\S{6,}/gi;
const LONG_HEX_RE = /\b[A-Fa-f0-9]{32,}\b/g;

/** Strip obvious credentials before anything is stored or prompted. */
export function redactActivityText(s: string): string {
  return s
    .replace(SECRET_RE, (m) => `${m.split(/[\s:=]/)[0]} [redacted]`)
    .replace(LONG_HEX_RE, '[hex]');
}

function actorLabel(actor: ActivityActor): string {
  if (actor === 'user') return 'user';
  if (actor === 'ai') return 'assistant';
  if (actor === 'system') return 'app';
  if (actor.startsWith('ext:')) return actor.slice(4);
  return actor;
}

/** One event → one narrative line: `19:42 user opened pdf "x.pdf" ×3 — detail`. */
export function renderActivityLine(ev: IActivityEvent): string {
  const d = new Date(ev.ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  let line = `${hh}:${mm} ${actorLabel(ev.actor)} ${ev.verb} ${ev.object}`;
  if (ev.count > 1) line += ` ×${ev.count}`;
  if (ev.detail) line += ` — ${ev.detail}`;
  return line;
}

// ── Service ─────────────────────────────────────────────────────────────────

const RING_CAP = 600;           // in-memory session history
const COALESCE_WINDOW_MS = 90_000;
const FLUSH_DELAY_MS = 1_000;   // batch window
const FLUSH_MAX_PENDING = 32;   // force-flush threshold
const RETENTION_ROWS = 4_000;   // per-workspace DB cap

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS activity_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  actor  TEXT    NOT NULL,
  verb   TEXT    NOT NULL,
  object TEXT    NOT NULL,
  detail TEXT,
  source TEXT    NOT NULL DEFAULT '',
  count  INTEGER NOT NULL DEFAULT 1
)`;
const CREATE_INDEX = `CREATE INDEX IF NOT EXISTS activity_log_ts_idx ON activity_log(ts)`;

export class ActivityJournalService extends Disposable implements IActivityJournalService {
  private readonly _onDidAppend = this._register(new Emitter<IActivityEvent>());
  readonly onDidAppend: Event<IActivityEvent> = this._onDidAppend.event;

  private readonly _ring: IActivityEvent[] = [];
  private _pending: IActivityEvent[] = [];
  private _db: IDatabaseService | undefined;
  private _tableReady = false;
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _now: () => number;

  constructor(now: () => number = Date.now) {
    super();
    this._now = now;
    this._register(toDisposable(() => {
      if (this._flushTimer) clearTimeout(this._flushTimer);
    }));
  }

  note(n: IActivityNote): void {
    try {
      const verb = String(n?.verb ?? '').trim();
      const object = String(n?.object ?? '').trim();
      if (!verb || !object) return;
      const actor: ActivityActor = typeof n.actor === 'string' && n.actor ? n.actor : 'user';
      const detailRaw = typeof n.detail === 'string' ? n.detail.trim() : '';
      const ts = this._now();

      // Coalesce: same actor+verb+object within the window folds into the
      // previous line. The ring entry mutates in place (count/ts/detail); the
      // persisted row for it, if not yet flushed, mutates with it — and if it
      // WAS already flushed, we accept a slightly-low stored count over an
      // UPDATE round-trip per keystroke burst.
      const last = this._ring[this._ring.length - 1];
      if (last && last.actor === actor && last.verb === verb && last.object === object
          && ts - last.ts < COALESCE_WINDOW_MS) {
        (last as { ts: number }).ts = ts;
        last.count += 1;
        if (detailRaw) (last as { detail?: string }).detail = redactActivityText(detailRaw).slice(0, 300);
        this._onDidAppend.fire(last);
        this._scheduleFlush();
        return;
      }

      const ev: IActivityEvent = {
        ts,
        actor,
        verb: verb.slice(0, 40),
        object: redactActivityText(object).slice(0, 160),
        detail: detailRaw ? redactActivityText(detailRaw).slice(0, 300) : undefined,
        source: typeof n.source === 'string' && n.source ? n.source.slice(0, 40) : 'app',
        count: 1,
      };
      this._ring.push(ev);
      if (this._ring.length > RING_CAP) this._ring.splice(0, this._ring.length - RING_CAP);
      this._pending.push(ev);
      this._scheduleFlush();
      this._onDidAppend.fire(ev);
    } catch {
      // A journal must never break the surface it observes.
    }
  }

  tail(n: number): readonly IActivityEvent[] {
    return this._ring.slice(Math.max(0, this._ring.length - Math.max(0, n)));
  }

  renderRecent(opts?: { maxLines?: number; sinceMs?: number }): string {
    const maxLines = opts?.maxLines ?? 30;
    const since = opts?.sinceMs;
    let events = typeof since === 'number'
      ? this._ring.filter((e) => e.ts >= since)
      : this._ring;
    events = events.slice(Math.max(0, events.length - maxLines));
    return events.map(renderActivityLine).join('\n');
  }

  async query(opts?: { limit?: number; sinceTs?: number }): Promise<readonly IActivityEvent[]> {
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    const since = opts?.sinceTs ?? 0;
    if (this._db?.isOpen && this._tableReady) {
      try {
        await this.flush();
        const rows = await this._db.all<{ ts: number; actor: string; verb: string; object: string; detail: string | null; source: string; count: number }>(
          `SELECT ts, actor, verb, object, detail, source, count
             FROM activity_log WHERE ts >= ? ORDER BY ts DESC LIMIT ?`,
          [since, limit],
        );
        return rows.reverse().map((r) => ({
          ts: Number(r.ts) || 0,
          actor: r.actor,
          verb: r.verb,
          object: r.object,
          detail: r.detail ?? undefined,
          source: r.source,
          count: Number(r.count) || 1,
        }));
      } catch { /* fall through to ring */ }
    }
    return this.tail(limit).filter((e) => e.ts >= since);
  }

  attachDatabase(db: IDatabaseService): void {
    if (this._db === db) return;
    this._db = db;
    this._tableReady = false;
    const arm = () => { void this._ensureTable(); };
    this._register(db.onDidOpen(arm));
    this._register(db.onDidClose(() => { this._tableReady = false; }));
    if (db.isOpen) arm();
  }

  async flush(): Promise<void> {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = undefined; }
    if (this._pending.length === 0) return;
    if (!this._db?.isOpen || !this._tableReady) return; // ring keeps the session; DB catches up next open
    const batch = this._pending;
    this._pending = [];
    try {
      await this._db.runTransaction(batch.map((e) => ({
        type: 'run' as const,
        sql: `INSERT INTO activity_log (ts, actor, verb, object, detail, source, count) VALUES (?,?,?,?,?,?,?)`,
        params: [e.ts, e.actor, e.verb, e.object, e.detail ?? null, e.source, e.count],
      })));
    } catch (err) {
      // Best-effort mirror: drop the batch rather than grow without bound.
      console.warn('[ActivityJournal] flush failed (batch dropped):', err instanceof Error ? err.message : err);
    }
  }

  private _scheduleFlush(): void {
    if (this._pending.length >= FLUSH_MAX_PENDING) { void this.flush(); return; }
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => { this._flushTimer = undefined; void this.flush(); }, FLUSH_DELAY_MS);
  }

  private async _ensureTable(): Promise<void> {
    if (!this._db?.isOpen) return;
    try {
      await this._db.run(CREATE_TABLE);
      await this._db.run(CREATE_INDEX);
      this._tableReady = true;
      // Count-capped retention (M91 precedent): keep the newest N rows.
      await this._db.run(
        `DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY ts DESC LIMIT ?)`,
        [RETENTION_ROWS],
      );
      void this.flush();
    } catch (err) {
      console.warn('[ActivityJournal] table init failed:', err instanceof Error ? err.message : err);
    }
  }
}
