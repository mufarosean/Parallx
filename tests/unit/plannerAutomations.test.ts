// @vitest-environment jsdom
//
// M93 — Planner Automations tab.
//
// Covers the pure schedule-spec conversions, the automation→cron-job shape,
// the planner-owned id bookkeeping, the missed-run catch-up story (app off at
// fire time → one coalesced run at next launch), and the tab's DOM states
// (runtime-not-ready, empty, cards, other-jobs section).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseTimeOfDay,
  buildCronSchedule,
  specFromSchedule,
  describeSchedule,
  createAutomationJob,
  loadAutomationIds,
  saveAutomationIds,
  PlannerAutomationsController,
  AUTOMATION_TEMPLATES,
  type AutomationScheduleSpec,
  type CronServiceLike,
} from '../../src/built-in/planner/plannerAutomations.js';
import {
  CronService,
  type ICronJob,
  type ICronPersistedSnapshot,
} from '../../src/openclaw/openclawCronService.js';

// ─── parseTimeOfDay ──────────────────────────────────────────────────────────

describe('parseTimeOfDay', () => {
  it('parses valid 24h times', () => {
    expect(parseTimeOfDay('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay('0:05')).toEqual({ hour: 0, minute: 5 });
  });
  it('rejects malformed and out-of-range input', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('12:60')).toBeNull();
    expect(parseTimeOfDay('noon')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay('12')).toBeNull();
  });
});

// ─── buildCronSchedule ───────────────────────────────────────────────────────

describe('buildCronSchedule', () => {
  it('daily → 5-field cron at the local wall-clock time', () => {
    expect(buildCronSchedule({ kind: 'daily', time: '08:30' })).toEqual({ cron: '30 8 * * *' });
  });
  it('weekly → cron with day-of-week field', () => {
    expect(buildCronSchedule({ kind: 'weekly', day: 1, time: '07:15' })).toEqual({ cron: '15 7 * * 1' });
  });
  it('interval → every-duration schedule', () => {
    expect(buildCronSchedule({ kind: 'interval', every: '30m' })).toEqual({ every: '30m' });
    expect(buildCronSchedule({ kind: 'interval', every: '1d' })).toEqual({ every: '1d' });
  });
  it('once → ISO at-schedule (future only)', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(buildCronSchedule({ kind: 'once', at: future })).toEqual({ at: future });
  });
  it('cron passthrough keeps the expression', () => {
    expect(buildCronSchedule({ kind: 'cron', expr: '0 9 * * 1-5' })).toEqual({ cron: '0 9 * * 1-5' });
  });
  it('rejects bad time, bad weekday, bad interval, past once, short cron', () => {
    expect(() => buildCronSchedule({ kind: 'daily', time: '25:00' })).toThrow(/Invalid time/);
    expect(() => buildCronSchedule({ kind: 'weekly', day: 9, time: '08:00' })).toThrow(/weekday/);
    expect(() => buildCronSchedule({ kind: 'interval', every: 'soon' })).toThrow(/Invalid interval/);
    expect(() => buildCronSchedule({ kind: 'once', at: new Date(Date.now() - 1000).toISOString() }))
      .toThrow(/future/);
    expect(() => buildCronSchedule({ kind: 'cron', expr: '* *' })).toThrow(/5 fields/);
  });
});

// ─── specFromSchedule (inverse) ──────────────────────────────────────────────

describe('specFromSchedule', () => {
  it('round-trips daily and weekly specs', () => {
    const daily: AutomationScheduleSpec = { kind: 'daily', time: '08:30' };
    expect(specFromSchedule(buildCronSchedule(daily))).toEqual(daily);
    const weekly: AutomationScheduleSpec = { kind: 'weekly', day: 3, time: '17:05' };
    expect(specFromSchedule(buildCronSchedule(weekly))).toEqual(weekly);
  });
  it('round-trips interval and once', () => {
    expect(specFromSchedule({ every: '45m' })).toEqual({ kind: 'interval', every: '45m' });
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(specFromSchedule({ at })).toEqual({ kind: 'once', at });
  });
  it('falls back to raw cron for expressions the form cannot rebuild', () => {
    expect(specFromSchedule({ cron: '0 9 * * 1-5' })).toEqual({ kind: 'cron', expr: '0 9 * * 1-5' });
    expect(specFromSchedule({ cron: '*/10 * * * *' })).toEqual({ kind: 'cron', expr: '*/10 * * * *' });
  });
});

// ─── describeSchedule ────────────────────────────────────────────────────────

describe('describeSchedule', () => {
  it('renders friendly text for each kind', () => {
    expect(describeSchedule({ cron: '0 8 * * *' })).toBe('Every day at 08:00');
    expect(describeSchedule({ cron: '30 7 * * 1' })).toBe('Every Monday at 07:30');
    expect(describeSchedule({ every: '2h' })).toBe('Every 2h');
    expect(describeSchedule({ cron: '0 9 * * 1-5' })).toBe('Cron: 0 9 * * 1-5');
  });
});

// ─── createAutomationJob against the REAL CronService ───────────────────────

function makeCron(executor = vi.fn(async () => { /* noop */ })) {
  const service = new CronService(executor, async () => [], null);
  return { service, executor };
}

describe('createAutomationJob', () => {
  it('creates an agent-turn job with the prompt as payload AND description', () => {
    const { service } = makeCron();
    const job = createAutomationJob(service, {
      name: 'Morning refresh',
      prompt: 'Refresh every dashboard widget.',
      spec: { kind: 'daily', time: '08:00' },
    });
    expect(job.payload.agentTurn).toBe('Refresh every dashboard widget.');
    expect(job.description).toBe('Refresh every dashboard widget.');
    expect(job.wakeMode).toBe('now');
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).not.toBeNull();
    expect(job.deleteAfterRun).toBeUndefined();
    service.dispose();
  });

  it('one-shot automations self-delete after running', () => {
    const { service } = makeCron();
    const job = createAutomationJob(service, {
      name: 'One off',
      prompt: 'Do the thing once.',
      spec: { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() },
    });
    expect(job.deleteAfterRun).toBe(true);
    service.dispose();
  });

  it('rejects empty name or prompt before touching the cron service', () => {
    const { service } = makeCron();
    expect(() => createAutomationJob(service, { name: ' ', prompt: 'x', spec: { kind: 'interval', every: '1h' } }))
      .toThrow(/name/);
    expect(() => createAutomationJob(service, { name: 'x', prompt: '  ', spec: { kind: 'interval', every: '1h' } }))
      .toThrow(/AI should do/);
    expect(service.jobCount).toBe(0);
    service.dispose();
  });
});

// ─── Missed-run catch-up (the "app was off at 8am" story) ────────────────────

describe('missed-run catch-up', () => {
  it('a job whose fire time passed while the app was closed runs ONCE at next launch', async () => {
    const executor = vi.fn(async () => { /* noop */ });
    const service = new CronService(executor, async () => [], null);

    // Simulate the previous session's persisted snapshot: a daily job whose
    // nextRunAt fell 3 hours ago (several notional firings ago).
    const snapshot: ICronPersistedSnapshot = {
      jobs: [{
        id: 'cron-1',
        name: 'Morning refresh',
        schedule: { cron: '0 8 * * *' },
        payload: { agentTurn: 'Refresh the dashboard.' },
        wakeMode: 'now',
        contextMessages: 0,
        enabled: true,
        createdAt: Date.now() - 7 * 86_400_000,
        lastRunAt: Date.now() - 86_400_000,
        nextRunAt: Date.now() - 3 * 3_600_000,
        runCount: 6,
      } as ICronJob],
    };
    service.setPersistence({
      load: async () => snapshot,
      save: async () => { /* noop */ },
    });

    await service.loadFromPersistence();
    service.start();
    // Missed-job catchup fires asynchronously (fire-and-forget promise).
    await new Promise((r) => setTimeout(r, 20));

    expect(executor).toHaveBeenCalledTimes(1);
    const job = service.jobs.find(j => j.id === 'cron-1');
    expect(job).toBeDefined();
    // After the coalesced catch-up the job is rescheduled into the future.
    expect(job!.nextRunAt).toBeGreaterThan(Date.now());
    expect(job!.runCount).toBe(7);
    service.dispose();
  });
});

// ─── Owned-id bookkeeping ────────────────────────────────────────────────────

function makeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getSetting: async (key: string) => map.get(key) ?? null,
    setSetting: async (key: string, value: string) => { map.set(key, value); },
    _map: map,
  };
}

describe('automation id persistence', () => {
  it('round-trips and de-duplicates ids', async () => {
    const store = makeStore();
    await saveAutomationIds(store, ['cron-1', 'cron-2', 'cron-1']);
    expect(await loadAutomationIds(store)).toEqual(['cron-1', 'cron-2']);
  });
  it('tolerates corrupt JSON', async () => {
    const store = makeStore({ 'automations.ids': '{nope' });
    expect(await loadAutomationIds(store)).toEqual([]);
  });
});

// ─── Controller DOM states ───────────────────────────────────────────────────

function stubWindow() {
  return {
    showInformationMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
  };
}

function stubCron(jobs: Partial<ICronJob>[]): CronServiceLike {
  const full = jobs.map((j, i) => ({
    id: `cron-${i + 1}`,
    name: 'job',
    schedule: { every: '1h' },
    payload: {},
    wakeMode: 'now',
    contextMessages: 0,
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: null,
    nextRunAt: Date.now() + 60_000,
    runCount: 0,
    ...j,
  } as ICronJob));
  return {
    jobs: full,
    addJob: vi.fn(),
    updateJob: vi.fn(),
    removeJob: vi.fn(() => true),
    getJob: (id: string) => full.find(j => j.id === id),
    runJob: vi.fn(async () => ({ success: true })),
    getJobRuns: () => [],
    onDidChangeJobs: () => ({ dispose() { /* noop */ } }),
  } as unknown as CronServiceLike;
}

describe('PlannerAutomationsController', () => {
  let body: HTMLElement;
  let actions: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    body = document.createElement('div');
    actions = document.createElement('div');
    document.body.append(body, actions);
  });

  it('renders the runtime-not-ready state when cron is unavailable', async () => {
    const ctrl = new PlannerAutomationsController({
      getCron: () => null,
      settings: makeStore(),
      window: stubWindow(),
    });
    await ctrl.render(body, actions);
    expect(body.textContent).toContain('still starting');
    const addBtn = actions.querySelector('button') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    ctrl.dispose();
  });

  it('renders the voice-registry empty state with a working New-automation button', async () => {
    const ctrl = new PlannerAutomationsController({
      getCron: () => stubCron([]),
      settings: makeStore(),
      window: stubWindow(),
    });
    await ctrl.render(body, actions);
    // M89 voice registry — the hero comes from EMPTY_STATES['planner.automations'].
    expect(body.querySelector('.px-empty')).toBeTruthy();
    expect(body.textContent).toContain('Put the app to work');
    const addBtn = actions.querySelector('button') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
    addBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(body.querySelector('.planner-auto__form')).toBeTruthy();
    // Template dropdown present on create.
    expect(body.querySelector('.ui-dropdown')).toBeTruthy();
    ctrl.dispose();
  });

  it('splits owned automations from other scheduled jobs', async () => {
    const cron = stubCron([
      { id: 'cron-1', name: 'Mine', payload: { agentTurn: 'Do my thing' } },
      { id: 'cron-2', name: 'budget.sync.scheduled', description: 'Extension job' },
    ]);
    const store = makeStore({ 'automations.ids': JSON.stringify(['cron-1']) });
    const ctrl = new PlannerAutomationsController({
      getCron: () => cron,
      settings: store,
      window: stubWindow(),
    });
    await ctrl.render(body, actions);

    const cards = body.querySelectorAll('.planner-auto__card');
    expect(cards.length).toBe(2);
    const others = body.querySelector('.planner-auto__others');
    expect(others).toBeTruthy();
    expect(others!.textContent).toContain('budget.sync.scheduled');
    // Owned card shows the prompt.
    expect(body.textContent).toContain('Do my thing');
    ctrl.dispose();
  });

  it('stale-cleans owned ids whose jobs no longer exist', async () => {
    const cron = stubCron([{ id: 'cron-9', name: 'Still here' }]);
    const store = makeStore({ 'automations.ids': JSON.stringify(['cron-9', 'cron-gone']) });
    const ctrl = new PlannerAutomationsController({
      getCron: () => cron,
      settings: store,
      window: stubWindow(),
    });
    await ctrl.render(body, actions);
    expect(await loadAutomationIds(store)).toEqual(['cron-9']);
    ctrl.dispose();
  });
});

// ─── Templates stay generic ──────────────────────────────────────────────────

describe('AUTOMATION_TEMPLATES', () => {
  it('every template has a non-empty prompt', () => {
    for (const t of AUTOMATION_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(10);
    }
  });
});
