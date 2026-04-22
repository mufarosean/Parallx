// autonomyLogService.ts — M58-real post-ship: dedicated autonomy log
//
// Replaces the "append autonomous results to chat" surface. The chat
// transcript stays clean; heartbeat / cron / subagent results now land
// here in a dedicated, time-ordered log that the user can browse in AI
// Settings and the agent can query via the `autonomy_log` tool.
//
// Design:
//   - Ring buffer (MAX_ENTRIES, oldest trimmed on overflow)
//   - Entries are append-only and immutable apart from a read flag
//   - Tiny event bus for UI subscription (onDidAppend / onDidChange)
//   - No persistence in this revision — buffer is per-process. Persistence
//     can be layered in later by wrapping append() to mirror to disk.
//
// Why not a SQLite table yet:
//   - M53 (portable storage) is the right place to land durable storage
//     for this, and we haven't spec'd the schema. Until then, a volatile
//     log preserves UX (you see autonomy happen in real time) without
//     committing to a schema we'll regret.
//
// Upstream parity: none — this is a Parallx UX-reshape of M58. Upstream
// openclaw surfaces autonomous results directly in the transcript because
// its chat UI treats cards as first-class citizens. Parallx's chat is
// conversational-first, so we separate the two.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';

/** Origin tag for an autonomous entry. Matches SURFACE_ORIGIN_KEY values. */
export type AutonomyOrigin = 'heartbeat' | 'cron' | 'subagent' | 'agent' | string;

export interface IAutonomyLogEntry {
  readonly id: string;
  readonly timestamp: number;
  /** heartbeat | cron | subagent | agent (from SURFACE_ORIGIN_KEY). */
  readonly origin: AutonomyOrigin;
  /** Human-readable request label — e.g. "[cron · morning-mail]". */
  readonly requestText: string;
  /** Markdown body produced by the autonomous turn. */
  readonly content: string;
  /** Optional surface metadata snapshot (shallow-copied, read-only). */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Chat session the user was viewing when the entry was produced. */
  readonly sessionId?: string;
  /** Whether the user (or the agent via markRead) has seen this entry. */
  readonly read: boolean;
}

export interface IAutonomyLogAppendInput {
  readonly origin: AutonomyOrigin;
  readonly requestText: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly sessionId?: string;
}

/** Narrow write-only view — passed to ChatSurfacePlugin. */
export interface IAutonomyLogAppender {
  append(input: IAutonomyLogAppendInput): IAutonomyLogEntry;
}

/** Narrow read-only view — passed to the autonomy_log tool. */
export interface IAutonomyLogReader {
  getEntries(opts?: { readonly limit?: number; readonly origin?: AutonomyOrigin; readonly onlyUnread?: boolean }): readonly IAutonomyLogEntry[];
  getUnreadCount(): number;
  markRead(ids?: readonly string[]): number;
}

/** Max entries retained before oldest are trimmed. */
export const AUTONOMY_LOG_MAX_ENTRIES = 200;

/** Default limit when a reader doesn't specify one. */
export const AUTONOMY_LOG_DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------

export class AutonomyLogService implements IAutonomyLogAppender, IAutonomyLogReader {
  private readonly _entries: IAutonomyLogEntry[] = [];
  private readonly _onDidAppend = new Emitter<IAutonomyLogEntry>();
  private readonly _onDidChange = new Emitter<void>();
  private _seq = 0;

  /** Fires when a new entry is appended. */
  readonly onDidAppend: Event<IAutonomyLogEntry> = this._onDidAppend.event;

  /** Fires for any mutation (append, markRead, clear). Cheap "something changed" signal for UI. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  append(input: IAutonomyLogAppendInput): IAutonomyLogEntry {
    const entry: IAutonomyLogEntry = {
      id: `al-${Date.now().toString(36)}-${(this._seq++).toString(36)}`,
      timestamp: Date.now(),
      origin: input.origin,
      requestText: input.requestText,
      content: input.content,
      metadata: input.metadata,
      sessionId: input.sessionId,
      read: false,
    };
    this._entries.push(entry);
    // Trim from the front when over cap — oldest out.
    if (this._entries.length > AUTONOMY_LOG_MAX_ENTRIES) {
      this._entries.splice(0, this._entries.length - AUTONOMY_LOG_MAX_ENTRIES);
    }
    this._onDidAppend.fire(entry);
    this._onDidChange.fire();
    return entry;
  }

  getEntries(opts?: { readonly limit?: number; readonly origin?: AutonomyOrigin; readonly onlyUnread?: boolean }): readonly IAutonomyLogEntry[] {
    const limit = opts?.limit ?? AUTONOMY_LOG_DEFAULT_LIMIT;
    const origin = opts?.origin;
    const onlyUnread = opts?.onlyUnread === true;
    // Walk newest-first so caller gets the most recent `limit` entries.
    const out: IAutonomyLogEntry[] = [];
    for (let i = this._entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this._entries[i];
      if (origin && e.origin !== origin) continue;
      if (onlyUnread && e.read) continue;
      out.push(e);
    }
    return out;
  }

  getUnreadCount(): number {
    let n = 0;
    for (const e of this._entries) if (!e.read) n++;
    return n;
  }

  /**
   * Mark the listed ids (or all entries if omitted) as read. Returns the
   * count of entries that transitioned unread → read.
   */
  markRead(ids?: readonly string[]): number {
    const set = ids && ids.length > 0 ? new Set(ids) : null;
    let changed = 0;
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      if (e.read) continue;
      if (set && !set.has(e.id)) continue;
      this._entries[i] = { ...e, read: true };
      changed++;
    }
    if (changed > 0) this._onDidChange.fire();
    return changed;
  }

  /** Drop everything. Used by the Settings UI "clear" button. */
  clear(): void {
    if (this._entries.length === 0) return;
    this._entries.length = 0;
    this._onDidChange.fire();
  }

  /** Total entry count (read + unread). */
  get size(): number { return this._entries.length; }

  dispose(): void {
    this._onDidAppend.dispose();
    this._onDidChange.dispose();
  }
}
