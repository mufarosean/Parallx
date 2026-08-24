// plannerSyncOrchestrator.ts — drives registered ICalendarSyncProvider(s).
//
// The planner exposes registerSyncProvider() but nothing drove the providers.
// This is that engine: on a timer and on demand it pulls remote changes, applies
// them locally (dedupe by source_id), then pushes local edits upstream. Conflict
// policy is remote-wins-if-the-remote-moved (see rule 2 below): the shared
// account is the source of truth several workspaces are replicas of.
//
// Echo avoidance lives in PlannerDataService: applying a remote upsert stamps
// synced_at = updated_at, so the same change is not re-detected as a local edit.
// Per-provider cursors + watermarks are persisted in the planner_settings KV.
//
// Two rules make several workspaces on one Google account converge instead of
// fighting, and both were learned the hard way:
//
//  1. APPLY BEFORE ACKNOWLEDGING. A provider cursor is a promise to the remote
//     that we have taken delivery. Persist it only once every row it covers is
//     in the database — a cursor written first turns any later failure into
//     permanent, silent data loss, because the remote will never resend.
//
//  2. COMPARE LIKE CLOCKS. "Who edited last" is decided by the remote's own
//     stamp against the remote stamp we recorded at the last reconcile
//     (remoteUpdatedAt) — never by our local updated_at, which merely records
//     when THIS workspace last touched the row and is always the later number.

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../platform/events.js';
import type { PlannerDataService } from '../plannerDataService.js';
import type {
  ICalendarSyncProvider,
  PlannerEvent,
  PlannerTask,
  SyncCalendarSnapshot,
} from '../plannerTypes.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_HISTORY_MS = 30 * 24 * 60 * 60 * 1000; // first pull only goes back 30d

export interface SyncRunResult {
  readonly ok: boolean;
  readonly provider: string;
  readonly pulledUpserts: number;
  readonly pulledDeletes: number;
  readonly pushed: number;
  readonly pushedDeletes: number;
  /** Local mirrors dropped because a full pull proved they are gone upstream. */
  readonly prunedStale: number;
  /** Items whose push upstream failed. A run with failures is NOT "up to date":
   *  these used to be console-only, so a workspace that pushed nothing still
   *  reported success. */
  readonly pushFailed: number;
  /** First push failure, for the status surface. */
  readonly pushError?: string;
  readonly error?: string;
}

/** Surface the settings panel uses to show status + trigger a sync. */
export interface IPlannerSyncController {
  readonly onDidChange: Event<void>;
  readonly isRunning: boolean;
  readonly lastResults: readonly SyncRunResult[];
  syncNow(): Promise<readonly SyncRunResult[]>;
  getLastSyncMs(providerId: string): Promise<number | null>;
  /** Re-evaluate which built-in providers should be active, then sync. */
  refreshProviders(): Promise<void>;
  /** Throw away every incremental cursor and re-read the account in full, then
   *  reconcile away local mirrors the remote no longer has. The repair for a
   *  replica that has drifted — a workspace that acknowledged changes it never
   *  applied can only be fixed by re-reading from scratch. */
  resyncFromScratch(): Promise<readonly SyncRunResult[]>;
}

export interface PlannerSyncOrchestratorDeps {
  readonly data: PlannerDataService;
  /** Every currently-registered provider (built-in + external). */
  readonly getProviders: () => readonly ICalendarSyncProvider[];
  /** Register/unregister built-in providers based on connection status. */
  readonly ensureProviders: () => Promise<void>;
}

export class PlannerSyncOrchestrator extends Disposable implements IPlannerSyncController {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _lastResults: SyncRunResult[] = [];
  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(private readonly _deps: PlannerSyncOrchestratorDeps) {
    super();
  }

  get isRunning(): boolean { return this._running; }
  get lastResults(): readonly SyncRunResult[] { return this._lastResults; }

  start(): void {
    if (this._timer) return;
    this._timer = setInterval(() => { void this.syncNow(); }, SYNC_INTERVAL_MS);
    // Kick an initial reconcile once providers are wired.
    void this.refreshProviders();
  }

  override dispose(): void {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    super.dispose();
  }

  async getLastSyncMs(providerId: string): Promise<number | null> {
    const raw = await this._deps.data.getSetting(`sync.${providerId}.lastSyncMs`);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  async refreshProviders(): Promise<void> {
    try {
      await this._deps.ensureProviders();
    } catch (err) {
      console.warn('[PlannerSync] ensureProviders failed:', err);
    }
    await this.syncNow();
  }

  async syncNow(): Promise<readonly SyncRunResult[]> {
    return this._run(false);
  }

  /**
   * Re-read the whole account and reconcile, ignoring every cursor.
   *
   * A workspace whose cursor once advanced past changes it never applied cannot
   * recover incrementally — from Google's side those changes were delivered and
   * will never be sent again. Only a full re-read puts this replica back level
   * with the account (and with every other workspace on it).
   */
  async resyncFromScratch(): Promise<readonly SyncRunResult[]> {
    return this._run(true);
  }

  private async _run(forceFull: boolean): Promise<readonly SyncRunResult[]> {
    if (this._running) return this._lastResults;
    const providers = this._deps.getProviders();
    if (providers.length === 0) {
      this._lastResults = [];
      return this._lastResults;
    }
    this._running = true;
    this._onDidChange.fire();
    try {
      const results: SyncRunResult[] = [];
      for (const provider of providers) {
        results.push(await this._syncProvider(provider, forceFull));
      }
      this._lastResults = results;
      return results;
    } finally {
      this._running = false;
      this._onDidChange.fire();
    }
  }

  /**
   * One reconcile pass for one provider.
   *
   * Ordering is load-bearing:
   *   snapshot local dirt → pull → apply pull → reconcile snapshots →
   *   push → COMMIT CURSORS.
   * The commit is last on purpose. Everything before it is replayable: if the
   * run dies anywhere, the next run asks the remote the same question again.
   * The moment the cursor moves, it is not.
   */
  private async _syncProvider(provider: ICalendarSyncProvider, forceFull = false): Promise<SyncRunResult> {
    const data = this._deps.data;
    const key = (k: string): string => `sync.${provider.id}.${k}`;
    const runStart = Date.now();
    let pulledUpserts = 0;
    let pulledDeletes = 0;
    let pushed = 0;
    let pushedDeletes = 0;
    let prunedStale = 0;
    let pushFailed = 0;
    let pushError: string | undefined;
    const notePushFailure = (what: string, err: unknown): void => {
      const msg = err instanceof Error ? err.message : String(err);
      pushFailed++;
      pushError ??= `${what}: ${msg}`;
      console.warn(`[PlannerSync] push failed for ${what}:`, msg);
    };

    try {
      if (forceFull) await provider.resetCursors?.();

      // First-ever pull is bounded so we don't ingest years of history.
      let sinceMs = parseInt((await data.getSetting(key('sinceFloorMs'))) ?? '', 10);
      if (!Number.isFinite(sinceMs)) {
        sinceMs = runStart - INITIAL_HISTORY_MS;
        await data.setSetting(key('sinceFloorMs'), String(sinceMs));
      }
      const token = forceFull ? undefined : ((await data.getSetting(key('token'))) || undefined);

      // Snapshot local push candidates BEFORE applying remote, so conflict
      // detection compares the pre-sync local state against the remote.
      const candidates = await data.listEventsToPush(provider.id);
      const dirtyBySource = new Map<string, PlannerEvent>();
      const localOnly: PlannerEvent[] = [];
      for (const ev of candidates) {
        if (ev.sourceId && ev.sourceProvider === provider.id) dirtyBySource.set(ev.sourceId, ev);
        else if (!ev.sourceProvider) localOnly.push(ev);
      }

      // ── Pull ──
      const pull = await provider.pull({ token, sinceMs });
      for (const ev of pull.upsertedEvents) {
        const dirtyLocal = dirtyBySource.get(ev.sourceId);
        if (dirtyLocal && !remoteMovedSinceReconcile(dirtyLocal, ev.updatedAt)) {
          // The remote is still the exact version we last reconciled — nobody
          // else touched it, so our un-pushed edit is the only new information.
          // Keep local; the push below carries it upstream.
          continue;
        }
        // Either a clean row, or a genuine conflict: the remote moved on since
        // we last saw it. The shared account wins — that is what makes two
        // workspaces on one Google account converge instead of ping-ponging.
        dirtyBySource.delete(ev.sourceId);
        await data.upsertEventFromSync(ev);
        pulledUpserts++;
      }
      for (const delId of pull.deletedEventSourceIds) {
        dirtyBySource.delete(delId);
        await data.applyRemoteEventDeletion(provider.id, delId);
        pulledDeletes++;
      }
      // Remote per-occurrence exceptions (edits/cancels of a single instance).
      for (const ov of pull.upsertedOverrides ?? []) {
        await data.applyOverrideFromSync(provider.id, ov);
        pulledUpserts++;
      }

      // ── Reconcile full snapshots ──
      // Only meaningful after a complete listing, and only once its rows are
      // applied — otherwise we would prune events this very pull just brought.
      for (const snap of pull.snapshots ?? []) {
        prunedStale += await this._reconcileSnapshot(provider.id, snap);
      }

      // ── Push (create local-only, update locally-won edits) ──
      if (provider.pushEvent) {
        for (const ev of [...localOnly, ...dirtyBySource.values()]) {
          try {
            const { providerId, remoteUpdatedAt } = await provider.pushEvent(ev);
            await data.markEventSynced(ev.id, provider.id, providerId, remoteUpdatedAt);
            pushed++;
          } catch (err) {
            notePushFailure(`event ${ev.id}`, err);
          }
        }
      }

      // ── Push local exceptions (this/following/all "this event" edits) ──
      if (provider.pushOverride) {
        for (const { baseSourceId, override } of await data.listOverridesToPush(provider.id)) {
          try {
            const { providerId, remoteUpdatedAt } = await provider.pushOverride(baseSourceId, override);
            await data.markOverrideSynced(override.id, providerId, remoteUpdatedAt);
            pushed++;
          } catch (err) {
            notePushFailure(`override ${override.id}`, err);
          }
        }
      }

      // ── Tasks (symmetric to events) ──
      // The provider self-gates its pull (empty arrays when task sync is off),
      // so applying pulled tasks is always safe; pushing local tasks is gated.
      const taskSyncOn = !!provider.pushTask
        && (provider.wantsTaskSync ? await provider.wantsTaskSync() : false);

      const taskCandidates = taskSyncOn ? await data.listTasksToPush() : [];
      const dirtyTasksBySource = new Map<string, PlannerTask>();
      const localOnlyTasks: PlannerTask[] = [];
      for (const t of taskCandidates) {
        if (t.sourceId && t.sourceProvider === provider.id) dirtyTasksBySource.set(t.sourceId, t);
        else if (!t.sourceProvider) localOnlyTasks.push(t);
      }

      for (const t of pull.upsertedTasks ?? []) {
        const dirtyLocal = dirtyTasksBySource.get(t.sourceId);
        if (dirtyLocal && !remoteMovedSinceReconcile(dirtyLocal, t.updatedAt)) continue;
        dirtyTasksBySource.delete(t.sourceId);
        await data.upsertTaskFromSync(t);
        pulledUpserts++;
      }
      for (const delId of pull.deletedTaskSourceIds ?? []) {
        dirtyTasksBySource.delete(delId);
        await data.applyRemoteTaskDeletion(provider.id, delId);
        pulledDeletes++;
      }
      if (taskSyncOn && provider.pushTask) {
        for (const t of [...localOnlyTasks, ...dirtyTasksBySource.values()]) {
          try {
            const { providerId, remoteUpdatedAt } = await provider.pushTask(t);
            await data.markTaskSynced(t.id, provider.id, providerId, remoteUpdatedAt);
            pushed++;
          } catch (err) {
            notePushFailure(`task ${t.id}`, err);
          }
        }
      }

      // ── Push deletions (local deletes → upstream, via tombstones) ──
      const deletions = await data.listDeletions(provider.id);
      for (const del of deletions) {
        try {
          if (del.kind === 'event' && provider.deleteEvent) {
            await provider.deleteEvent(del.sourceId, del.remoteParent ?? undefined);
            await data.clearDeletion(provider.id, del.sourceId);
            pushedDeletes++;
          } else if (del.kind === 'task' && provider.deleteTask) {
            await provider.deleteTask(del.sourceId, del.remoteParent ?? undefined);
            await data.clearDeletion(provider.id, del.sourceId);
            pushedDeletes++;
          }
          // Provider can't handle this kind yet — leave the tombstone in place.
        } catch (err) {
          notePushFailure(`delete ${del.sourceId}`, err);
        }
      }

      // ── Commit cursors — LAST, and only on a clean run ──
      // Everything this pull reported is now in the database, so it is finally
      // safe to tell the provider we took delivery. Any throw above skips this,
      // and the next run re-reads the same window instead of losing it.
      await provider.commitCursors?.();
      if (pull.nextToken !== undefined) await data.setSetting(key('token'), pull.nextToken);
      await data.setSetting(key('lastSyncMs'), String(runStart));

      return {
        ok: true, provider: provider.id,
        pulledUpserts, pulledDeletes, pushed, pushedDeletes, prunedStale, pushFailed, pushError,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[PlannerSync] provider ${provider.id} failed:`, msg);
      return {
        ok: false, provider: provider.id,
        pulledUpserts, pulledDeletes, pushed, pushedDeletes, prunedStale, pushFailed, pushError,
        error: msg,
      };
    }
  }

  /** Drop local mirrors a complete remote listing proves are gone upstream. */
  private async _reconcileSnapshot(providerId: string, snap: SyncCalendarSnapshot): Promise<number> {
    try {
      const n = await this._deps.data.pruneCalendarToSnapshot(
        providerId, snap.calendarId, snap.sourceIds, snap.fromMs,
      );
      if (n > 0) console.info(`[PlannerSync] pruned ${n} stale mirror(s) in ${snap.calendarId}`);
      return n;
    } catch (err) {
      console.warn('[PlannerSync] snapshot reconcile failed:', err);
      return 0;
    }
  }
}

/**
 * Did the remote change since the version this workspace last reconciled?
 *
 * The exact answer compares two readings of the PROVIDER's clock: `remote` (the
 * stamp on the row we just pulled) against `lastSeenRemote` (the stamp recorded
 * when we last applied or pushed that row). Same clock, so the comparison means
 * what it says.
 *
 * What it must never do — and what the old code did — is compare against the
 * local `updated_at`. Applying a pull stamps updated_at with the LOCAL now, so
 * a row's local "last modified" is really "when I last pulled it", a number
 * that outranks every remote stamp. A stale replica therefore won every
 * conflict and PATCHed its stale copy back over a good edit made in another
 * workspace — the two-workspaces-one-account divergence this fixes.
 *
 * Fallback for rows carrying no remote stamp yet (written before the column
 * existed): compare against `syncedAt` — "did the remote move after I last
 * talked to it?". That crosses clocks, but between two NTP-synced machines it
 * is an approximation of the right question rather than a certainty about the
 * wrong one. With neither stamp, defer to the remote: a discarded local edit is
 * still in front of the user to redo, a clobbered shared calendar is not.
 */
function remoteMovedSinceReconcile(
  local: { readonly remoteUpdatedAt?: number | null; readonly syncedAt?: number | null },
  remote: number | undefined,
): boolean {
  if (remote == null) return true;
  if (local.remoteUpdatedAt != null) return remote > local.remoteUpdatedAt;
  if (local.syncedAt != null) return remote > local.syncedAt;
  return true;
}
