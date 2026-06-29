// plannerSyncOrchestrator.ts — drives registered ICalendarSyncProvider(s).
//
// The planner exposes registerSyncProvider() but nothing drove the providers.
// This is that engine: on a timer and on demand it pulls remote changes, applies
// them locally (dedupe by source_id), then pushes local edits upstream. Conflict
// policy is last-write-wins by updatedAt vs the provider's reported `updatedAt`.
//
// Echo avoidance lives in PlannerDataService: applying a remote upsert stamps
// synced_at = updated_at, so the same change is not re-detected as a local edit.
// Per-provider cursors + watermarks are persisted in the planner_settings KV.

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../platform/events.js';
import type { PlannerDataService } from '../plannerDataService.js';
import type { ICalendarSyncProvider, PlannerEvent, PlannerTask } from '../plannerTypes.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_HISTORY_MS = 30 * 24 * 60 * 60 * 1000; // first pull only goes back 30d

export interface SyncRunResult {
  readonly ok: boolean;
  readonly provider: string;
  readonly pulledUpserts: number;
  readonly pulledDeletes: number;
  readonly pushed: number;
  readonly pushedDeletes: number;
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
        results.push(await this._syncProvider(provider));
      }
      this._lastResults = results;
      return results;
    } finally {
      this._running = false;
      this._onDidChange.fire();
    }
  }

  private async _syncProvider(provider: ICalendarSyncProvider): Promise<SyncRunResult> {
    const data = this._deps.data;
    const key = (k: string): string => `sync.${provider.id}.${k}`;
    const runStart = Date.now();
    let pulledUpserts = 0;
    let pulledDeletes = 0;
    let pushed = 0;
    let pushedDeletes = 0;

    try {
      // First-ever pull is bounded so we don't ingest years of history.
      let sinceMs = parseInt((await data.getSetting(key('sinceFloorMs'))) ?? '', 10);
      if (!Number.isFinite(sinceMs)) {
        sinceMs = runStart - INITIAL_HISTORY_MS;
        await data.setSetting(key('sinceFloorMs'), String(sinceMs));
      }
      const token = (await data.getSetting(key('token'))) || undefined;

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
        if (dirtyLocal) {
          const remoteUpdated = ev.updatedAt ?? 0;
          if (dirtyLocal.updatedAt > remoteUpdated) {
            // Local edited more recently — keep local; it gets pushed below.
            continue;
          }
          // Remote wins — apply it and don't push the stale local copy back.
          dirtyBySource.delete(ev.sourceId);
        }
        await data.upsertEventFromSync(ev);
        pulledUpserts++;
      }
      for (const delId of pull.deletedEventSourceIds) {
        dirtyBySource.delete(delId);
        await data.applyRemoteEventDeletion(provider.id, delId);
        pulledDeletes++;
      }

      // ── Push (create local-only, update locally-won edits) ──
      if (provider.pushEvent) {
        for (const ev of [...localOnly, ...dirtyBySource.values()]) {
          try {
            const { providerId } = await provider.pushEvent(ev);
            await data.markEventSynced(ev.id, provider.id, providerId);
            pushed++;
          } catch (err) {
            console.warn(`[PlannerSync] push failed for event ${ev.id}:`, err);
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
        if (dirtyLocal) {
          if (dirtyLocal.updatedAt > (t.updatedAt ?? 0)) continue; // local newer
          dirtyTasksBySource.delete(t.sourceId);
        }
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
            const { providerId } = await provider.pushTask(t);
            await data.markTaskSynced(t.id, provider.id, providerId);
            pushed++;
          } catch (err) {
            console.warn(`[PlannerSync] push failed for task ${t.id}:`, err);
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
          console.warn(`[PlannerSync] delete push failed for ${del.sourceId}:`, err);
        }
      }

      if (pull.nextToken !== undefined) await data.setSetting(key('token'), pull.nextToken);
      await data.setSetting(key('lastSyncMs'), String(runStart));

      return { ok: true, provider: provider.id, pulledUpserts, pulledDeletes, pushed, pushedDeletes };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[PlannerSync] provider ${provider.id} failed:`, msg);
      return { ok: false, provider: provider.id, pulledUpserts, pulledDeletes, pushed, pushedDeletes, error: msg };
    }
  }
}
