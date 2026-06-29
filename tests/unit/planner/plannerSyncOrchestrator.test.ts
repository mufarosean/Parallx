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
  markedEvents: { id: string; sourceId: string }[] = [];
  upsertedTasks: SyncedTask[] = [];
  appliedTaskDeletions: string[] = [];
  markedTasks: { id: string; sourceId: string }[] = [];
  clearedDeletions: string[] = [];

  async getSetting(k: string) { return this.settings.get(k) ?? null; }
  async setSetting(k: string, v: string) { this.settings.set(k, v); }
  async listEventsToPush() { return this.pushList; }
  async getEventBySource(p: string, s: string) {
    return this.events.find((e) => e.sourceProvider === p && e.sourceId === s) ?? null;
  }
  async upsertEventFromSync(ev: SyncedEvent) { this.upsertedEvents.push(ev); }
  async applyRemoteEventDeletion(_p: string, s: string) { this.appliedEventDeletions.push(s); }
  async markEventSynced(id: string, _p: string, s: string) { this.markedEvents.push({ id, sourceId: s }); }
  async listTasksToPush() { return this.tasksPushList; }
  async upsertTaskFromSync(t: SyncedTask) { this.upsertedTasks.push(t); }
  async applyRemoteTaskDeletion(_p: string, s: string) { this.appliedTaskDeletions.push(s); }
  async markTaskSynced(id: string, _p: string, s: string) { this.markedTasks.push({ id, sourceId: s }); }
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

  async pull() { return this.pullResult; }
  async pushEvent(local: PlannerEvent) { this.pushedEvents.push(local); return { providerId: `srv-${local.id}` }; }
  async deleteEvent(sourceId: string, parent?: string) { this.deletedEvents.push({ id: sourceId, parent }); }
  async pushTask(local: PlannerTask) { this.pushedTasks.push(local); return { providerId: `srv-${local.id}` }; }
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
    expect(data.markedEvents).toEqual([{ id: 'e2', sourceId: 'srv-e2' }]);
  });

  it('last-write-wins: remote newer overwrites local and is not pushed back', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const local = makeEvent({ id: 'e1', sourceProvider: 'google', sourceId: 'g1', updatedAt: 1000 });
    data.events = [local];
    data.pushList = [local]; // dirty
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', updatedAt: 2000 })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents.map((e) => e.sourceId)).toEqual(['g1']); // remote applied
    expect(provider.pushedEvents).toHaveLength(0); // not pushed back
  });

  it('last-write-wins: local newer is kept and pushed, remote skipped', async () => {
    const data = new FakeData();
    const provider = new FakeProvider();
    const local = makeEvent({ id: 'e1', sourceProvider: 'google', sourceId: 'g1', updatedAt: 5000 });
    data.events = [local];
    data.pushList = [local];
    provider.pullResult = { upsertedEvents: [syncedEvent({ sourceId: 'g1', updatedAt: 2000 })], deletedEventSourceIds: [] };
    await makeOrchestrator(data, provider).syncNow();
    expect(data.upsertedEvents).toHaveLength(0); // remote NOT applied
    expect(provider.pushedEvents.map((e) => e.id)).toEqual(['e1']); // local pushed
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
    expect(data.markedTasks).toEqual([{ id: 't1', sourceId: 'srv-t1' }]);
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
