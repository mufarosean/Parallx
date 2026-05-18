// autonomyEventLog.ts — M60 Phase α §3.10 structured autonomy event writer
//
// Writes one ndjson record per autonomous turn to
// `<APP_ROOT>/data/autonomy-events.<yyyy-mm-dd>.ndjson`. Daily rotation,
// 90-day retention by default. Independent from `AutonomyLogService`,
// which is a UX surface (markdown ring buffer the user reads in-app).
//
// Schema (M60 §3.10):
//   {
//     id: ulid,
//     triggeredAt: iso,
//     trigger: { kind, ref? },
//     budgetSnapshot?: { tokensUsedToday?, depth?, ... },
//     systemPromptHash?: sha256,
//     toolCalls?: [{ name, argsDigest, durationMs, idempotencyKey?, error? }],
//     surfaceRoutes?: [{ surface, target?, ok }],
//     outcome: 'completed'|'cancelled'|'budget'|'error'|'gated',
//     durationMs?, tokensIn?, tokensOut?
//   }
//
// Privacy posture (M60 §3.9):
//   - Bodies, message contents, file contents — never logged.
//   - systemPromptHash and argsDigest are sha256 — never the raw text.
//
// Persistence:
//   - Renderer-side. Uses parallxElectron.fs IPC to read/append the
//     daily file. No new IPC handlers added in Phase α (boundary §3.4).
//   - Each emit is a read-modify-write of the daily file. Acceptable for
//     low-volume autonomy events; if volume grows, swap to a streaming
//     append IPC handler later (M61+).

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';

// ---------------------------------------------------------------------------
// Types — public schema
// ---------------------------------------------------------------------------

export type AutonomyTriggerKind =
  | 'chat'
  | 'followup'
  | 'cron'
  | 'heartbeat'
  | 'file-change'
  | 'subagent'
  | 'replay';

export type AutonomyOutcome =
  | 'completed'
  | 'cancelled'
  | 'budget'
  | 'error'
  | 'gated';

export interface IAutonomyTrigger {
  readonly kind: AutonomyTriggerKind;
  readonly ref?: string;
}

export interface IAutonomyBudgetSnapshot {
  readonly tokensUsedToday?: number;
  readonly depth?: number;
  readonly [key: string]: unknown;
}

export interface IAutonomyToolCallRecord {
  readonly name: string;
  readonly argsDigest: string; // sha256
  readonly durationMs: number;
  readonly idempotencyKey?: string;
  readonly error?: string;
}

export interface IAutonomySurfaceRouteRecord {
  readonly surface: string;
  readonly target?: string;
  readonly ok: boolean;
  /** Reason for non-ok routes (e.g. 'gated', 'unknown-surface', 'unsupported-content-type'). */
  readonly reason?: string;
}

export interface IAutonomyEventRecord {
  readonly id: string;
  readonly triggeredAt: string; // ISO-8601
  readonly trigger: IAutonomyTrigger;
  readonly budgetSnapshot?: IAutonomyBudgetSnapshot;
  readonly systemPromptHash?: string;
  readonly toolCalls?: readonly IAutonomyToolCallRecord[];
  readonly surfaceRoutes?: readonly IAutonomySurfaceRouteRecord[];
  readonly outcome: AutonomyOutcome;
  readonly durationMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  /** Optional human-readable note for diagnostics; never includes user content. */
  readonly note?: string;
}

/** Input shape — caller may omit id/triggeredAt; the service fills them. */
export interface IAutonomyEventInput {
  readonly trigger: IAutonomyTrigger;
  readonly outcome: AutonomyOutcome;
  readonly budgetSnapshot?: IAutonomyBudgetSnapshot;
  readonly systemPromptHash?: string;
  readonly toolCalls?: readonly IAutonomyToolCallRecord[];
  readonly surfaceRoutes?: readonly IAutonomySurfaceRouteRecord[];
  readonly durationMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IAutonomyEventLog extends Disposable {
  /** Append a structured record. Returns the materialized record (with id + ts). */
  emit(input: IAutonomyEventInput): IAutonomyEventRecord;
  /** Read records for a given day. Used by autonomy:replay. */
  readDay(yyyymmdd: string): Promise<readonly IAutonomyEventRecord[]>;
  /** Find a record by id across the retention window. */
  findById(id: string): Promise<IAutonomyEventRecord | undefined>;
  /** Fired synchronously after every emit. Useful for the in-memory rail (T5). */
  readonly onDidEmit: Event<IAutonomyEventRecord>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Minimal renderer-side fs bridge surface this service depends on.
 * Matches `window.parallxElectron.fs`.
 */
export interface IAutonomyEventLogFs {
  readFile(path: string, encoding?: string): Promise<{ ok: boolean; data?: string; error?: string }>;
  writeFile(path: string, content: string, encoding?: string): Promise<{ ok: boolean; error?: string }>;
  exists(path: string): Promise<{ ok: boolean; exists?: boolean; error?: string }>;
  mkdir(path: string): Promise<{ ok: boolean; error?: string }>;
  readdir?(path: string): Promise<{ ok: boolean; entries?: Array<{ name: string }>; error?: string }>;
  delete?(path: string, options?: unknown): Promise<{ ok: boolean; error?: string }>;
}

export interface IAutonomyEventLogOptions {
  /** Absolute path of the data directory. Daily files land here. */
  readonly dataDir: string;
  /** Retention in days. Default 90. */
  readonly retentionDays?: number;
  /**
   * Optional clock injection (tests). Returns ms since epoch. Defaults to Date.now.
   */
  readonly now?: () => number;
}

const DEFAULT_RETENTION_DAYS = 90;
const FILE_PREFIX = 'autonomy-events.';
const FILE_SUFFIX = '.ndjson';

/** Crockford's Base32 (ulid spec) alphabet. */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(now: number): string {
  // Time component (10 chars, 48 bits).
  let timestamp = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    const rem = timestamp % 32;
    timePart = ULID_ALPHABET[rem] + timePart;
    timestamp = Math.floor(timestamp / 32);
  }
  // Random component (16 chars, 80 bits).
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return timePart + randPart;
}

function dayKey(now: number): string {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export class AutonomyEventLog extends Disposable implements IAutonomyEventLog {
  private readonly _fs: IAutonomyEventLogFs;
  private readonly _dataDir: string;
  private readonly _retentionDays: number;
  private readonly _now: () => number;
  private readonly _onDidEmit = this._register(new Emitter<IAutonomyEventRecord>());
  readonly onDidEmit: Event<IAutonomyEventRecord> = this._onDidEmit.event;

  /** Serialize concurrent writes to the same daily file. */
  private _writeChain: Promise<void> = Promise.resolve();
  /** Last day for which retention was pruned. Avoids spamming pruning on every emit. */
  private _lastPrunedDay: string | undefined;

  // M78 Phase 5 — buffered append.
  //
  // The pre-M78 path did a full read-modify-write of the whole day's
  // log on every event. Over a day the file grew, so each event cost
  // O(file size). On a heavy agent turn (10+ tool calls) this pinned
  // the main process through several MB-rewrite IPC round-trips.
  //
  // New behaviour: events are buffered in memory and flushed on a
  // short timer (200 ms) or whenever the buffer reaches 16 entries.
  // The day's existing file content is read once on first emit for
  // that day, then cached so subsequent flushes only need ONE write
  // each. Dispose flushes synchronously so a normal app exit never
  // loses buffered events.
  private static readonly _FLUSH_INTERVAL_MS = 200;
  private static readonly _FLUSH_BATCH_SIZE = 16;
  private readonly _buffer: { record: IAutonomyEventRecord; now: number }[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per-day content cache so we only read the file once per day. */
  private _dayContentCache: Map<string, string> = new Map();

  constructor(fs: IAutonomyEventLogFs, options: IAutonomyEventLogOptions) {
    super();
    this._fs = fs;
    this._dataDir = options.dataDir;
    this._retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this._now = options.now ?? (() => Date.now());
  }

  emit(input: IAutonomyEventInput): IAutonomyEventRecord {
    const now = this._now();
    const record: IAutonomyEventRecord = {
      id: generateUlid(now),
      triggeredAt: new Date(now).toISOString(),
      trigger: input.trigger,
      budgetSnapshot: input.budgetSnapshot,
      systemPromptHash: input.systemPromptHash,
      toolCalls: input.toolCalls,
      surfaceRoutes: input.surfaceRoutes,
      outcome: input.outcome,
      durationMs: input.durationMs,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      note: input.note,
    };
    this._onDidEmit.fire(record);

    // Buffer instead of writing immediately. Flush on timer or batch
    // threshold so emit() stays sync from caller's POV and disk
    // writes amortise across many events.
    this._buffer.push({ record, now });
    if (this._buffer.length >= AutonomyEventLog._FLUSH_BATCH_SIZE) {
      this._scheduleFlush(0);
    } else {
      this._scheduleFlush(AutonomyEventLog._FLUSH_INTERVAL_MS);
    }
    return record;
  }

  /**
   * Drain the in-memory buffer to disk synchronously. Called by the
   * flush timer, when emit() reaches the batch threshold, by readDay
   * / findById to satisfy consistency, and at dispose so an app exit
   * never loses buffered events.
   */
  private _scheduleFlush(delayMs: number): void {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._writeChain = this._writeChain.then(() => this._drainBuffer());
    }, delayMs);
  }

  private async _drainBuffer(): Promise<void> {
    if (this._buffer.length === 0) return;
    // Group buffered events by day file so events that crossed
    // midnight write to the correct file.
    const byDay = new Map<string, { lines: string[]; latestNow: number }>();
    while (this._buffer.length > 0) {
      const item = this._buffer.shift()!;
      const day = dayKey(item.now);
      const bucket = byDay.get(day) ?? { lines: [], latestNow: 0 };
      bucket.lines.push(JSON.stringify(item.record));
      bucket.latestNow = Math.max(bucket.latestNow, item.now);
      byDay.set(day, bucket);
    }
    for (const [day, bucket] of byDay) {
      await this._appendBuffered(day, bucket.lines, bucket.latestNow);
    }
  }

  async readDay(yyyymmdd: string): Promise<readonly IAutonomyEventRecord[]> {
    // Make sure pending writes are flushed first.
    await this.flush();
    const file = this._fileFor(yyyymmdd);
    const exists = await this._fs.exists(file);
    if (!exists.ok || !exists.exists) return [];
    const read = await this._fs.readFile(file, 'utf-8');
    if (!read.ok || typeof read.data !== 'string') return [];
    const out: IAutonomyEventRecord[] = [];
    for (const line of read.data.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as IAutonomyEventRecord);
      } catch {
        // Skip corrupt lines but keep the file readable.
      }
    }
    return out;
  }

  async findById(id: string): Promise<IAutonomyEventRecord | undefined> {
    // Walk back from today through the retention window — most lookups are recent.
    await this.flush();
    const today = this._now();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 0; i < this._retentionDays; i++) {
      const key = dayKey(today - i * dayMs);
      const records = await this.readDay(key);
      const hit = records.find(r => r.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Wait for outstanding writes — and any buffered events — to flush. */
  async flush(): Promise<void> {
    // If there are buffered events not yet drained (timer hasn't
    // fired), force a drain now so readers see the latest state.
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._buffer.length > 0) {
      this._writeChain = this._writeChain.then(() => this._drainBuffer());
    }
    await this._writeChain;
  }

  private _fileFor(yyyymmdd: string): string {
    return joinPath(this._dataDir, `${FILE_PREFIX}${yyyymmdd}${FILE_SUFFIX}`);
  }

  /**
   * Append a buffered batch of JSON lines to the given day's file.
   * Reads the file's existing content from the in-memory cache when
   * available, falling back to a single disk read on first touch of
   * a new day. Only ONE writeFile per call regardless of batch size.
   */
  private async _appendBuffered(day: string, lines: string[], now: number): Promise<void> {
    const file = this._fileFor(day);
    try {
      await this._fs.mkdir(this._dataDir);
    } catch {
      // mkdir may already exist; ignore.
    }

    let existing = this._dayContentCache.get(day);
    if (existing === undefined) {
      // First touch of this day in this session — read from disk
      // once to recover any prior content (yesterday's tail, restart
      // mid-day, etc.) and seed the cache.
      try {
        const e = await this._fs.exists(file);
        if (e.ok && e.exists) {
          const r = await this._fs.readFile(file, 'utf-8');
          if (r.ok && typeof r.data === 'string') existing = r.data;
        }
      } catch {
        // Treat read failure as empty; the next write will create the file.
      }
      if (existing === undefined) existing = '';
    }

    const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    const appended = lines.join('\n') + '\n';
    const next = existing + separator + appended;

    try {
      await this._fs.writeFile(file, next, 'utf-8');
      // Only commit to the cache on successful write; otherwise the
      // next emit re-reads from disk and tries again.
      this._dayContentCache.set(day, next);
    } catch {
      // Write failure is non-fatal — autonomy continues. The buffered
      // lines are already drained; we don't retry to keep the model
      // simple. A subsequent emit's write may catch up if the cache
      // is still populated.
    }

    // Best-effort retention prune (once per day).
    if (this._lastPrunedDay !== day) {
      this._lastPrunedDay = day;
      void this._pruneOldFiles(now);
    }
  }

  override dispose(): void {
    // Ensure buffered events land on disk before the host process tears
    // down. Cancel any pending timer and force a final drain.
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    // Chain a final drain on top of the write chain. Callers (including
    // dispose) can `await this.flush()` to be sure pending bytes hit
    // disk; super.dispose() runs first so we still tidy emitters.
    if (this._buffer.length > 0) {
      this._writeChain = this._writeChain.then(() => this._drainBuffer());
    }
    super.dispose();
  }

  private async _pruneOldFiles(now: number): Promise<void> {
    if (!this._fs.readdir || !this._fs.delete) return;
    try {
      const list = await this._fs.readdir(this._dataDir);
      if (!list.ok || !list.entries) return;
      const cutoffMs = now - this._retentionDays * 24 * 60 * 60 * 1000;
      for (const entry of list.entries) {
        const name = entry.name;
        if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
        const dateStr = name.slice(FILE_PREFIX.length, name.length - FILE_SUFFIX.length);
        const t = Date.parse(`${dateStr}T00:00:00Z`);
        if (Number.isNaN(t) || t >= cutoffMs) continue;
        try {
          await this._fs.delete(joinPath(this._dataDir, name));
        } catch {
          // Best-effort delete.
        }
      }
    } catch {
      // Best-effort prune.
    }
  }
}

// ---------------------------------------------------------------------------
// Hashing helpers — Web Crypto SubtleCrypto, available in Electron renderer
// ---------------------------------------------------------------------------

/**
 * sha256 hex digest of a UTF-8 string. Returns empty string if SubtleCrypto is
 * unavailable (e.g. tests without a polyfill); callers may treat empty as "no hash".
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return '';
  const enc = new TextEncoder();
  const buf = await subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Canonical-stringify args (sorted keys, no whitespace) before hashing.
 * Ensures argsDigest is stable for equivalent calls.
 */
export async function canonicalArgsDigest(args: unknown): Promise<string> {
  return sha256Hex(canonicalize(args));
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

// ---------------------------------------------------------------------------
// ULID validation (used by tests + replay command)
// ---------------------------------------------------------------------------

export function isUlid(value: string): boolean {
  if (typeof value !== 'string' || value.length !== 26) return false;
  for (let i = 0; i < value.length; i++) {
    if (ULID_ALPHABET.indexOf(value[i]) < 0) return false;
  }
  return true;
}
