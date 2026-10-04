// scheduleSources.test.ts — the heartbeat and workflow facts read the
// user's schedule from whatever tools keep one, never from a named tool.
//
// A tool registers a schedule source while it runs; turned off, it goes and
// its facts with it. The core defines no tool's interface.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  registerScheduleSource,
  getScheduleSources,
  listScheduleOpenTasks,
  listScheduleTaskFacts,
  getScheduleToday,
  getScheduleSyncHealth,
  captureScheduleFollowUp,
  type ScheduleSource,
} from '../../src/services/scheduleSources';
import { evaluateTriggers } from '../../src/openclaw/heartbeatTriggers';
import { normalizeFactsInclude } from '../../src/services/workflows/workflowTypes';
import { resolveSignalActor } from '../../src/services/autonomySignalService';
import type { IDisposable } from '../../src/platform/lifecycle';

const live: IDisposable[] = [];
const reg = (s: ScheduleSource) => { const d = registerScheduleSource(s); live.push(d); return d; };
afterEach(() => { while (live.length) live.pop()!.dispose(); });

function source(over: Partial<ScheduleSource> = {}): ScheduleSource {
  const filed = new Set<string>();
  return {
    id: 'acme.planner',
    name: 'Acme',
    listOpenTasks: async () => [{ title: 'Water plants', dueAt: null }],
    listTaskFacts: async () => [{ id: 't1', title: 'Water plants', status: 'planned', dueAt: 1, createdAt: 0 }],
    getToday: async () => ({ events: 2, tasksDue: 1, hint: 'Open Acme for the full picture.' }),
    getSyncHealth: async () => ({ failed: true, detail: 'Acme: 401' }),
    captureFollowUp: async ({ sourceKey }) => { if (filed.has(sourceKey)) return false; filed.add(sourceKey); return true; },
    ...over,
  };
}

describe('schedule sources', () => {
  it('with none registered, there is nothing: no tasks, no today, no sync, no follow-ups', async () => {
    expect(getScheduleSources()).toEqual([]);
    expect(await listScheduleOpenTasks()).toEqual([]);
    expect(await listScheduleTaskFacts()).toEqual([]);
    expect(await getScheduleToday()).toBeNull();
    expect(await getScheduleSyncHealth()).toBeNull();
    expect(await captureScheduleFollowUp({ title: 'x', sourceKey: 'k' })).toBeUndefined();
  });

  it('register → read; dispose → gone', async () => {
    const d = reg(source());
    expect(await listScheduleOpenTasks()).toEqual([{ title: 'Water plants', dueAt: null }]);
    expect((await listScheduleTaskFacts()).map((t) => t.id)).toEqual(['t1']);
    expect(await getScheduleToday()).toEqual({ events: 2, tasksDue: 1, hint: 'Open Acme for the full picture.' });
    expect(await getScheduleSyncHealth()).toEqual({ failed: true, detail: 'Acme: 401' });
    const filed = await captureScheduleFollowUp({ title: 'Follow up', sourceKey: 'overdue-task:t1' });
    expect(filed?.created).toBe(true);
    expect(filed?.source.name).toBe('Acme');
    expect((await captureScheduleFollowUp({ title: 'Follow up', sourceKey: 'overdue-task:t1' }))?.created).toBe(false);
    d.dispose();
    expect(getScheduleSources()).toEqual([]);
    expect(await getScheduleToday()).toBeNull();
    expect(await getScheduleSyncHealth()).toBeNull();
  });

  it('combines sources, and skips one that fails', async () => {
    reg(source());
    reg(source({
      id: 'other', name: 'Other',
      listOpenTasks: async () => { throw new Error('down'); },
      getToday: async () => ({ events: 1, tasksDue: 0 }),
      getSyncHealth: async () => ({ failed: false, detail: null }),
    }));
    expect(await listScheduleOpenTasks()).toHaveLength(1);
    // Summed; with two answers no single source's hint fits.
    expect(await getScheduleToday()).toEqual({ events: 3, tasksDue: 1 });
    expect(await getScheduleSyncHealth()).toEqual({ failed: true, detail: 'Acme: 401' });
  });

  it('sync is healthy when every syncing source is', async () => {
    reg(source({ getSyncHealth: async () => ({ failed: false, detail: null }) }));
    expect(await getScheduleSyncHealth()).toEqual({ failed: false, detail: null });
  });
});

describe('heartbeat notices name no tool', () => {
  const base = { plans: [], tasks: [] };

  it('sync failure: "Calendar sync is failing", with the source\'s own detail', () => {
    const r = evaluateTriggers({ ...base, sync: { failed: true, detail: 'Planner: google: 401' } }, {}, Date.now());
    expect(r.findings[0].title).toBe('Calendar sync is failing');
    expect(r.findings[0].detail).toBe('Planner: google: 401');
    const bare = evaluateTriggers({ ...base, sync: { failed: true, detail: null } }, {}, Date.now());
    expect(bare.findings[0].detail).toBe('The last sync run reported an error.');
  });

  it('morning digest: the source\'s hint, or a generic one', () => {
    const at8 = new Date(2026, 6, 20, 8, 0).getTime();
    const r = evaluateTriggers({ ...base, today: { events: 1, tasksDue: 0, hint: 'Open the planner for the full picture.' } }, {}, at8);
    expect(r.findings[0].detail).toBe('Open the planner for the full picture.');
    const generic = evaluateTriggers({ ...base, today: { events: 1, tasksDue: 0 } }, {}, at8);
    expect(generic.findings[0].detail).not.toMatch(/planner/i);
  });

  it('the core declares no Planner interface; the Planner registers a schedule source', () => {
    const root = resolve(__dirname, '../..');
    expect(readFileSync(resolve(root, 'src/services/serviceTypes.ts'), 'utf8')).not.toMatch(/IPlannerQueryService/);
    expect(readFileSync(resolve(root, 'src/built-in/chat/main.ts'), 'utf8')).not.toMatch(/IPlannerQueryService/);
    expect(readFileSync(resolve(root, 'src/openclaw/heartbeatTriggers.ts'), 'utf8')).not.toMatch(/'Planner|the planner/);
    expect(readFileSync(resolve(root, 'src/built-in/planner/main.ts'), 'utf8')).toMatch(/registerScheduleSource\(\{/);
  });
});

describe('workflow facts include', () => {
  it('reads the old "planner" key as "schedule"', () => {
    expect(normalizeFactsInclude({ planner: true, activity: false })).toEqual({ schedule: true, activity: false });
    expect(normalizeFactsInclude({ schedule: false, planner: true })).toEqual({ schedule: false });
    expect(normalizeFactsInclude(undefined)).toEqual({});
  });
});

describe('signal actor', () => {
  it('the publisher\'s stamp wins; unstamped canvas is the user; unstamped tools are their own', () => {
    expect(resolveSignalActor({ source: 'canvas', actor: 'agent' })).toBe('agent');
    expect(resolveSignalActor({ source: 'canvas' })).toBe('user');
    expect(resolveSignalActor({ source: 'planner' })).toBeUndefined();
    expect(resolveSignalActor({ source: 'some-tool', actor: 'user' })).toBe('user');
  });
});
