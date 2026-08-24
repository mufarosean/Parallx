import { describe, it, expect } from 'vitest';
import { PlannerSyncOrchestrator } from '../../../src/built-in/planner/sync/plannerSyncOrchestrator.js';
import type { PlannerDataService } from '../../../src/built-in/planner/plannerDataService.js';
import type {
  ICalendarSyncProvider, PlannerEvent, PlannerTask, SyncedEvent, SyncedTask,
  SyncPullResult, SyncDeletion,
} from '../../../src/built-in/planner/plannerTypes.js';

// ─── Fakes ─────────────────────────────────────────────────────────────────

function makeEvent(p: Partial<PlannerEvent>): PlannerEvent {
  return {
    id: 'e1', title: 'E', description: null, startAt: 0, endAt: 0, allDay: false,
    location: null, calendarId: 'cal', color: null, recurrence: null,
    sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...p,
  };
}
function makeTask(p: Partial<PlannerTask>): PlannerTask {
  return {
    id: 't1', title: 'T', description: null, status: 'planned', dueAt: null, reminderAt: null,
    reminderFired: false, completedAt: null, tags: [], calendarId: 'cal-tasks', color: null,
    sourceUri: null, sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...p,
  };
}
function syncedEvent(p: Partial<SyncedEvent> & { sourceId: string }): SyncedEvent {
  return { title: 'E', startAt: 0, endAt: 0, sourceProvider: 'google', ...p };
}

class FakeData {
  settings = new Map<string, string>();
  events: PlannerEvent[] = [];
  pushList: PlannerEvent[] = [];
  tasksPushList: PlannerTask[] = [];
  deletions: SyncDeletion[] = [];

  upsertedEvents: SyncedEvent[] = [];
  appliedEventDeletions: string[] = [];
  markedEvents: { id: string; sourceId: string; remoteUpdatedAt: number | null }[] = [];
  upsertedTasks: SyncedTask[] = [];
  appliedTaskDeletions: string[] = [];
  markedTasks: { id: string; sourceId: string; remoteUpdatedAt: number | null }[] = [];
  clearedDeletions: string[] = [];

  async getSetting(k: string) { return this.settings.get(k) ?? null; }
  async setSetting(k: string, v: string) { this.settings.set(k, v); }
  async listEventsToPush() { return this.pushList; }
  async getEventBySource(p: string, s: string) {
    return this.events.find((e) => e.sourceProvider === p && e.sourceId === s) ?? null;
  }
  /** Set to make the apply step blow up mid-pull (the data-loss scenario). */
  upsertThrows = false;
  prunedCalls: { calendarId: string; sourceIds: readonly string[]; fromMs: number }[] = [];
  prunedCount = 0;

  async upsertEventFromSync(ev: SyncedEvent) {
    if (this.upsertThrows) throw new Error('db exploded');
    this.upsertedEvents.push(ev);
  }
  async pruneCalendarToSnapshot(_p: string, calendarId: string, sourceIds: readonly string[], fromMs: number) {
    this.prunedCalls.push({ calendarId, sourceIds, fromMs });
    return this.prunedCount;
  }
  async clearSyncCursors(provider: string) {
    for (const k of [...this.settings.keys()]) {
      if (k.startsWith(`sync.${provider}.`) && (k.endsWith('.token') || k.endsWith('.sinceFloorMs'))) {
        this.settings.delete(k);
      }
    }
  }
  async applyRemoteEventDeletion(_p: string, s: string) { this.appliedEventDeletions.push(s); }
  async markEventSynced(id: string, _p: string, s: string, remoteUpdatedAt?: number | null) {
    this.markedEvents.push({ id, sourceId: s, remoteUpdatedAt: remoteUpdatedAt ?? null });
  }
  async listTasksToPush() { return this.tasksPushList; }
  async upsertTaskFromSync(t: SyncedTask) { this.upsertedTasks.push(t); }
  async applyRemoteTaskDeletion(_p: string, s: string) { this.appliedTaskDeletions.push(s); }
  async markTaskSynced(id: string, _p: string, s: string, remoteUpdatedAt?: number | null) {
    this.markedTasks.push({ id, sourceId: s, remoteUpdatedAt: remoteUpdatedAt ?? null });
  }
  async listDeletions() { return this.deletions; }
  async clearDeletion(_p: string, s: string) { this.clearedDeletions.push(s); }
}

class FakeProvider implements ICalendarSyncProvider {
  id = 'google';
  displayName = 'Google';
  pullResult: SyncPullResult = { upsertedEvents: [], deletedEventSourceIds: [] };
  pushedEvents: PlannerEvent[] = [];
  deletedEvents: { id: string; parent?: string }[] = [];
  pushedTasks: PlannerTask[] = [];
  taskSync = false;

  committed = 0;
  cursorsReset = 0;
  pullStates: { token?: string; sinceMs: number }[] = [];
  /** Set to make every event push fail (the silently-swallowed scenario). */
  pushEventThrows = false;

  async pull(state: { token?: string; sinceMs: number }) { this.pullStates.push(state); return this.pullResult; }
  async commitCursors() { this.committed++; }
  async resetCursors() { this.cursorsReset++; }
  async pushEvent(local: PlannerEvent) {
    if (this.pushEventThrows) throw new Error('google said no');
    this.pushedEvents.push(local);
    return { providerId: `srv-${local.id}`, remoteUpdatedAt: 4242 };
  }
  async deleteEvent(sourceId: string, parent?: string) { this.deletedEvents.push({ id: sourceId, parent }); }
  async pushTask(local: PlannerTask) { this.pushedTasks.push(local); return { providerId: `srv-${local.id}`, remoteUpdatedAt: 4242 }; }
  async deleteTask() { /* noop */ }
  async wantsTaskSync() { return this.taskSync; }
}

function makeOrchestrator(data: FakeData, provider: FakeProvider): PlannerSyncOrchestrator {
  return new PlannerSyncOrchestrator({
    data: data as unknown as PlannerDataService,
    getProviders: () => [provider],
    ensureProviders: async () => { /* noop */ },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PlannerSyncOrchestrator — events', () => {
  it('inserts a brand-new remote event', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', title: 'New' })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents.map((e) => e.sourceId)).toEqual(['g1']);
    expect(provider.pushedEvents).toHaveLength(0);
  });

  it('pushes a new local-only event and records its provider id', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.pushList = [makeEvent({ id: 'e2', sourceProvider: null, sourceId: null })];
    await makeOrchestrator(data, provider).syncNow();
    expect(provider.pushedEvents.map((e) => e.id)).toEqual(['e2']);
    expect(data.markedEvents).toEqual([{ id: 'e2', sourceId: 'srv-e2', remoteUpdatedAt: 4242 }]);
  });

  it('remote that moved since our last reconcile overwrites local and is not pushed back', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const local = makeEvent({
      id: 'e1', sourceProvider: 'google', sourceId: 'g1',
      updatedAt: 1000, syncedAt: 900, remoteUpdatedAt: 1000,
    });
    data.events = [local];
    data.pushList = [local]; // dirty
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', updatedAt: 2000 })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents.map((e) => e.sourceId)).toEqual(['g1']); // remote applied
    expect(provider.pushedEvents).toHaveLength(0); // not pushed back
  });

  it('local edit is kept and pushed when the remote has not moved since the last reconcile', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const local = makeEvent({
      id: 'e1', sourceProvider: 'google', sourceId: 'g1',
      updatedAt: 5000, syncedAt: 1500, remoteUpdatedAt: 2000,
    });
    data.events = [local];
    data.pushList = [local];
    // Google still holds exactly the version we last reconciled.
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', updatedAt: 2000 })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents).toHaveLength(0); // remote NOT applied
    expect(provider.pushedEvents.map((e) => e.id)).toEqual(['e1']); // local pushed
  });

  // The two-workspaces-one-Google-account regression. Workspace B pulled this
  // row at local time 9_000_000 (so updated_at says 9_000_000 — pull time, not
  // an edit), then something dirtied it. Workspace A meanwhile made a real edit
  // that bumped Google's stamp 1000 → 2000. Comparing updated_at to Google's
  // stamp — the old rule — made B "newer" and B pushed its stale copy over A's
  // edit. Comparing remote-to-remote gets it right.
  it('a stale replica does not clobber an edit made in another workspace', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const stale = makeEvent({
      id: 'e1', sourceProvider: 'google', sourceId: 'g1', title: 'Work',
      updatedAt: 9_000_000, syncedAt: 8_999_000, remoteUpdatedAt: 1000,
    });
    data.events = [stale];
    data.pushList = [stale];
    provider.pullResult = {
      upsertedEvents: [syncedEvent({ sourceId: 'g1', title: 'Work/Flashcards', updatedAt: 2000 })],
      deletedEventSourceIds: [],
    };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents.map((e) => e.title)).toEqual(['Work/Flashcards']);
    expect(provider.pushedEvents).toHaveLength(0);
  });

  it('falls back to syncedAt for rows with no recorded remote stamp', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const local = makeEvent({
      id: 'e1', sourceProvider: 'google', sourceId: 'g1',
      updatedAt: 5000, syncedAt: 3000, remoteUpdatedAt: null,
    });
    data.events = [local];
    data.pushList = [local];
    // Google's copy predates our last reconcile ⇒ nobody else touched it.
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', updatedAt: 2500 })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents).toHaveLength(0);
    expect(provider.pushedEvents.map((e) => e.id)).toEqual(['e1']);
  });

  it('applies a remote deletion locally', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.pullResult = { upsertedEvents: [], deletedEventSourceIds: ['g9'] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.appliedEventDeletions).toEqual(['g9']);
  });

  it('pushes a local tombstone upstream then clears it', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.deletions = [{ provider: 'google', sourceId: 'g5', kind: 'event', remoteParent: 'calA' }];
    await makeOrchestrator(data, provider).syncNow();
    expect(provider.deletedEvents).toEqual([{ id: 'g5', parent: 'calA' }]);
    expect(data.clearedDeletions).toEqual(['g5']);
  });
});

describe('PlannerSyncOrchestrator — task gate', () => {
  it('does not push local tasks when task sync is off', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.taskSync = false;
    data.tasksPushList = [makeTask({ id: 't1' })];
    await makeOrchestrator(data, provider).syncNow();
    expect(provider.pushedTasks).toHaveLength(0);
  });

  it('pushes local tasks when task sync is on', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.taskSync = true;
    data.tasksPushList = [makeTask({ id: 't1', sourceProvider: null, sourceId: null })];
    await makeOrchestrator(data, provider).syncNow();
    expect(provider.pushedTasks.map((t) => t.id)).toEqual(['t1']);
    expect(data.markedTasks).toEqual([{ id: 't1', sourceId: 'srv-t1', remoteUpdatedAt: 4242 }]);
  });

  it('applies pulled task upserts/deletions regardless of push gate', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.taskSync = false;
    provider.pullResult = {
      upsertedEvents: [], deletedEventSourceIds: [],
      upsertedTasks: [{ title: 'Remote', sourceProvider: 'google', sourceId: 'rt1' }],
      deletedTaskSourceIds: ['rt2'],
    };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedTasks.map((t) => t.sourceId)).toEqual(['rt1']);
    expect(data.appliedTaskDeletions).toEqual(['rt2']);
  });
});

// ─── Cursor durability ───────────────────────────────────────────────────────
//
// A provider cursor is an acknowledgement to the remote: "delivered, don't send
// it again". Persisting one before the rows it covers are in the database is
// how a workspace ends up permanently missing changes another workspace made —
// Google considers them handed over and never resends. These lock the ordering.

describe('PlannerSyncOrchestrator — cursor durability', () => {
  it('commits cursors only after the whole pull has been applied', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1' })], deletedEventSourceIds: [] };
    const [result] = await makeOrchestrator(data, provider).syncNow();
    expect(result.ok).toBe(true);
    expect(provider.committed).toBe(1);
  });

  it('does NOT commit cursors when applying the pull fails', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.upsertThrows = true;
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1' })], deletedEventSourceIds: [] };
    const [result] = await makeOrchestrator(data, provider).syncNow();
    expect(result.ok).toBe(false);
    expect(provider.committed).toBe(0); // the batch stays unacknowledged → replayable
  });

  it('does NOT advance the orchestrator token when the run fails', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.upsertThrows = true;
    provider.pullResult = {
      upsertedEvents: [syncedEvent({ sourceId: 'g1' })], deletedEventSourceIds: [], nextToken: 'tok-2',
    };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.settings.get('sync.google.token')).toBeUndefined();
    expect(data.settings.get('sync.google.lastSyncMs')).toBeUndefined();
  });
});

// ─── Push failures are never silent ──────────────────────────────────────────

describe('PlannerSyncOrchestrator — push reporting', () => {
  it('reports pushes that failed instead of swallowing them', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    provider.pushEventThrows = true;
    data.pushList = [makeEvent({ id: 'e2', sourceProvider: null, sourceId: null })];
    const [result] = await makeOrchestrator(data, provider).syncNow();
    expect(result.pushed).toBe(0);
    expect(result.pushFailed).toBe(1);
    expect(result.pushError).toContain('google said no');
  });

  it('records the provider stamp a successful push produced', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.pushList = [makeEvent({ id: 'e2', sourceProvider: null, sourceId: null })];
    await makeOrchestrator(data, provider).syncNow();
    expect(data.markedEvents).toEqual([{ id: 'e2', sourceId: 'srv-e2', remoteUpdatedAt: 4242 }]);
  });
});

// ─── Full-snapshot reconciliation + repair ───────────────────────────────────

describe('PlannerSyncOrchestrator — full resync', () => {
  it('prunes local mirrors a complete listing proves are gone upstream', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.prunedCount = 2;
    provider.pullResult = {
      upsertedEvents: [syncedEvent({ sourceId: 'g1' })],
      deletedEventSourceIds: [],
      snapshots: [{ calendarId: 'cal', sourceIds: ['g1'], fromMs: 500 }],
    };
    const [result] = await makeOrchestrator(data, provider).syncNow();
    expect(data.prunedCalls).toEqual([{ calendarId: 'cal', sourceIds: ['g1'], fromMs: 500 }]);
    expect(result.prunedStale).toBe(2);
  });

  it('prunes only after the pull is applied, never before', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const order: string[] = [];
    data.upsertEventFromSync = async (ev: SyncedEvent) => { order.push(`apply:${ev.sourceId}`); };
    data.pruneCalendarToSnapshot = async () => { order.push('prune'); return 0; };
    provider.pullResult = {
      upsertedEvents: [syncedEvent({ sourceId: 'g1' })],
      deletedEventSourceIds: [],
      snapshots: [{ calendarId: 'cal', sourceIds: ['g1'], fromMs: 0 }],
    };
    await makeOrchestrator(data, provider).syncNow();
    expect(order).toEqual(['apply:g1', 'prune']);
  });

  it('resyncFromScratch drops every cursor and pulls without a token', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.settings.set('sync.google.token', 'stale-token');
    await makeOrchestrator(data, provider).resyncFromScratch();
    expect(provider.cursorsReset).toBe(1);
    expect(provider.pullStates[0].token).toBeUndefined();
  });

  it('a normal sync keeps using the stored token', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    data.settings.set('sync.google.token', 'tok-1');
    await makeOrchestrator(data, provider).syncNow();
    expect(provider.cursorsReset).toBe(0);
    expect(provider.pullStates[0].token).toBe('tok-1');
  });
});
