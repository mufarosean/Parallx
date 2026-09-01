// workflowService.test.ts — the spine: CRUD with the validation guard,
// scheduling on the cron grid, event triggers with the rate limit and
// echo guard, the pause flag, runNow, and persistence round-trips with
// missed-firing coalescing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import {
  WorkflowService,
  type IWorkflowPersistedSnapshot,
} from '../../src/services/workflows/workflowService';
import type { WorkflowExecutionDeps } from '../../src/services/workflows/workflowRunner';
import type { IActivityEvent } from '../../src/services/activityJournalService';

function makeDeps(): WorkflowExecutionDeps & { notifications: string[] } {
  const notifications: string[] = [];
  return {
    notifications,
    runAgentTurn: vi.fn(async () => 'done'),
    runCommand: vi.fn(async () => undefined),
    runTool: vi.fn(async () => ({ content: 'ok' })),
    notify: vi.fn((m: string) => { notifications.push(m); }),
  };
}

function makeService(deps = makeDeps()) {
  const service = new WorkflowService();
  service.attachExecution(deps);
  return { service, deps };
}

const notifyFlow = {
  name: 'Ping', class: 'quiet' as const, enabled: true, source: 'user' as const,
  nodes: [
    { id: 't', label: 'Manual', kind: 'trigger.manual' as const },
    { id: 'n', label: 'Notify', kind: 'action.notify' as const, message: 'ping' },
  ],
  edges: [{ from: 't', to: 'n' }],
};

describe('CRUD', () => {
  it('rejects structurally invalid documents, stores drafts', () => {
    const { service } = makeService();
    expect(() => service.addWorkflow({
      ...notifyFlow,
      edges: [{ from: 't', to: 'ghost' }],
    })).toThrow(/ghost/);
    // A draft (no trigger) is storable.
    const draft = service.addWorkflow({
      ...notifyFlow,
      nodes: [notifyFlow.nodes[1]],
      edges: [],
    });
    expect(service.getWorkflow(draft.id)).toBeTruthy();
  });

  it('installTemplate lands disabled; migrateCronJob preserves provenance', () => {
    const { service } = makeService();
    const t = service.installTemplate('morning-digest');
    expect(t.enabled).toBe(false);
    const m = service.migrateCronJob({
      id: 'cron-3', name: 'Old Job', schedule: { every: '2h' },
      payload: { agentTurn: 'do it' }, wakeMode: 'now', contextMessages: 0,
      enabled: true, createdAt: 0, lastRunAt: null, nextRunAt: null, runCount: 0,
    });
    expect(m.migratedFromCronId).toBe('cron-3');
    expect(service.workflows).toHaveLength(2);
  });
});

describe('runNow', () => {
  it('fires the manual trigger and records the run', async () => {
    const { service, deps } = makeService();
    const wf = service.addWorkflow(notifyFlow);
    const run = await service.runNow(wf.id);
    expect(run.status).toBe('ok');
    expect(deps.notifications).toEqual(['ping']);
    expect(service.getRuns(wf.id)).toHaveLength(1);
  });

  it('bypasses the global pause — user-initiated means approved', async () => {
    const { service, deps } = makeService();
    service.setObservers({ isPaused: () => true });
    const wf = service.addWorkflow(notifyFlow);
    const run = await service.runNow(wf.id);
    expect(run.status).toBe('ok');
    expect(deps.notifications).toEqual(['ping']);
  });

  it('a draft refuses to run, by name', async () => {
    const { service } = makeService();
    const draft = service.addWorkflow({ ...notifyFlow, nodes: [notifyFlow.nodes[1]], edges: [] });
    await expect(service.runNow(draft.id)).rejects.toThrow(/draft/);
  });
});

describe('event triggers', () => {
  const journal = () => new Emitter<IActivityEvent>();
  const eventFlow = {
    name: 'On Planner Create', class: 'quiet' as const, enabled: true, source: 'user' as const,
    nodes: [
      { id: 't', label: 'Planner Event', kind: 'trigger.event' as const, verb: 'created', source: 'tool' },
      { id: 'n', label: 'Notify', kind: 'action.notify' as const, message: '{{event.actor}} {{event.verb}}' },
    ],
    edges: [{ from: 't', to: 'n' }],
  };
  const entry = (over: Partial<IActivityEvent> = {}): IActivityEvent => ({
    ts: Date.now(), actor: 'ai', verb: 'created', object: 'task', source: 'tool', count: 1, ...over,
  });

  it('a matching journal entry fires the workflow with the event in context', async () => {
    const { service, deps } = makeService();
    const em = journal();
    service.attachJournalFeed(em.event);
    service.addWorkflow(eventFlow);
    em.fire(entry());
    await vi.waitFor(() => expect(deps.notifications).toEqual(['ai created']));
  });

  it('non-matching verb/source do not fire; disabled workflows never fire', async () => {
    const { service, deps } = makeService();
    const em = journal();
    service.attachJournalFeed(em.event);
    const wf = service.addWorkflow(eventFlow);
    em.fire(entry({ verb: 'deleted' }));
    em.fire(entry({ source: 'editor' }));
    service.setEnabled(wf.id, false);
    em.fire(entry());
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.notifications).toEqual([]);
  });

  it('rate limit: a chatty journal cannot fire the same trigger twice within a minute', async () => {
    const { service, deps } = makeService();
    const em = journal();
    service.attachJournalFeed(em.event);
    service.addWorkflow(eventFlow);
    em.fire(entry());
    em.fire(entry());
    em.fire(entry());
    await vi.waitFor(() => expect(deps.notifications).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.notifications).toHaveLength(1);
  });

  it('the echo guard: workflow-origin journal entries never re-trigger', async () => {
    const { service, deps } = makeService();
    const em = journal();
    service.attachJournalFeed(em.event);
    service.addWorkflow(eventFlow);
    em.fire(entry({ detail: 'workflow:wf-1' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.notifications).toEqual([]);
  });

  it('the pause flag holds automatic firings', async () => {
    const { service, deps } = makeService();
    service.setObservers({ isPaused: () => true });
    const em = journal();
    service.attachJournalFeed(em.event);
    service.addWorkflow(eventFlow);
    em.fire(entry());
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.notifications).toEqual([]);
  });
});

describe('scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('an interval workflow fires when its slot comes due, then advances the grid', async () => {
    const { service, deps } = makeService();
    const wf = service.addWorkflow({
      name: 'Every Minute', class: 'quiet', enabled: true, source: 'user',
      nodes: [
        { id: 't', label: 'Interval', kind: 'trigger.schedule', spec: { kind: 'interval', every: '1m' } },
        { id: 'n', label: 'Notify', kind: 'action.notify', message: 'tick' },
      ],
      edges: [{ from: 't', to: 'n' }],
    });
    service.start();
    expect(service.nextRunAt(wf.id)).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(deps.notifications).toEqual(['tick']);
    expect(service.nextRunAt(wf.id)).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(deps.notifications).toEqual(['tick', 'tick']);
    service.dispose();
  });

  it('a disabled workflow holds its slot silently', async () => {
    const { service, deps } = makeService();
    const wf = service.addWorkflow({
      name: 'Held', class: 'quiet', enabled: false, source: 'user',
      nodes: [
        { id: 't', label: 'Interval', kind: 'trigger.schedule', spec: { kind: 'interval', every: '1m' } },
        { id: 'n', label: 'Notify', kind: 'action.notify', message: 'tick' },
      ],
      edges: [{ from: 't', to: 'n' }],
    });
    service.start();
    await vi.advanceTimersByTimeAsync(130_000);
    expect(deps.notifications).toEqual([]);
    expect(service.getRuns(wf.id)).toHaveLength(0);
    service.dispose();
  });
});

describe('persistence', () => {
  it('round-trips docs, runs, and the ledger; past nextRunAt coalesces to now', async () => {
    let stored: IWorkflowPersistedSnapshot | null = null;
    const persistence = {
      load: async () => stored,
      save: async (s: IWorkflowPersistedSnapshot) => { stored = s; },
    };
    const a = makeService();
    a.service.setPersistence(persistence);
    const wf = a.service.addWorkflow(notifyFlow);
    await a.service.runNow(wf.id);
    await new Promise((r) => setTimeout(r, 5));
    expect(stored).not.toBeNull();

    // Simulate a snapshot whose schedule slot is in the past.
    stored = {
      ...stored!,
      schedules: { 'wf-9:t': { anchorMs: 1, nextRunAt: Date.now() - 999_999 } },
    };
    const b = makeService();
    b.service.setPersistence(persistence);
    await b.service.loadFromPersistence();
    expect(b.service.workflows).toHaveLength(1);
    expect(b.service.workflows[0].name).toBe('Ping');
    expect(b.service.runs).toHaveLength(1);
  });
});

describe('the arbiter', () => {
  it('mutex: a firing while the group is busy is HELD and recorded, never silent', async () => {
    const gate = { release: () => { /* replaced */ } };
    const slow = new Promise<void>((r) => { gate.release = r; });
    const deps = makeDeps();
    deps.runAgentTurn = vi.fn(async () => { await slow; return 'done'; });
    const { service } = makeService(deps);
    const mk = (name: string) => service.addWorkflow({
      name, class: 'quiet', enabled: true, source: 'user', mutexGroup: 'planner',
      nodes: [
        { id: 't', label: 'Manual', kind: 'trigger.manual' },
        { id: 'g', label: 'Turn', kind: 'action.agentTurn', prompt: 'go' },
      ],
      edges: [{ from: 't', to: 'g' }],
    });
    const a = mk('First');
    const b = mk('Second');
    const first = service.runNow(a.id);
    await new Promise((r) => setTimeout(r, 10)); // let it enter the group
    const held = await service.runNow(b.id);
    expect(held.status).toBe('held');
    expect(held.error).toContain('mutex');
    gate.release();
    expect((await first).status).toBe('ok');
    // Group freed — the second workflow runs now.
    gate.release();
    const retry = service.runNow(b.id);
    gate.release();
    expect((await retry).status).toBe('ok');
  });

  it('attention budget: automatic attention runs beyond the budget are HELD; Run Now never is', async () => {
    const { service, deps } = makeService();
    service.setObservers({ attentionBudgetPerDay: () => 1 });
    const em = new Emitter<IActivityEvent>();
    service.attachJournalFeed(em.event);
    const mk = (name: string, verb: string) => service.addWorkflow({
      name, class: 'attention', enabled: true, source: 'user',
      nodes: [
        { id: 't', label: 'Event', kind: 'trigger.event', verb },
        { id: 'n', label: 'Notify', kind: 'action.notify', message: name },
      ],
      edges: [{ from: 't', to: 'n' }],
    });
    const a = mk('First Interrupt', 'alpha');
    const b = mk('Second Interrupt', 'beta');
    em.fire({ ts: Date.now(), actor: 'ai', verb: 'alpha', object: 'x', source: 'tool', count: 1 });
    await vi.waitFor(() => expect(deps.notifications).toEqual(['First Interrupt']));
    em.fire({ ts: Date.now(), actor: 'ai', verb: 'beta', object: 'x', source: 'tool', count: 1 });
    await vi.waitFor(() => expect(service.getRuns(b.id)).toHaveLength(1));
    expect(service.getRuns(b.id)[0].status).toBe('held');
    expect(service.getRuns(b.id)[0].error).toContain('attention budget');
    // The user's own Run Now is not an interruption — it always passes.
    const manual = await service.runNow(b.id);
    expect(manual.status).toBe('ok');
    expect(service.getRuns(a.id)[0].status).toBe('ok');
  });
});

describe('observers', () => {
  it('onRunRecorded sees every run; its failure never breaks the run', async () => {
    const { service } = makeService();
    const seen: string[] = [];
    service.setObservers({
      onRunRecorded: (run) => { seen.push(run.status); throw new Error('observer bug'); },
    });
    const wf = service.addWorkflow(notifyFlow);
    const run = await service.runNow(wf.id);
    expect(run.status).toBe('ok');
    expect(seen).toEqual(['ok']);
  });
});
