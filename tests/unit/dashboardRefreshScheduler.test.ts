// dashboardRefreshScheduler.test.ts — M86 C4 admission control.
//
// The scheduler is the single gate every refresh passes through (scheduled
// AND manual since C4): single-flight per instance, AI fan-out capped by the
// live `dashboard.aiRefreshConcurrency` setting, FIFO queue for the rest.

import { describe, it, expect } from 'vitest';
import { DashboardRefreshScheduler } from '../../src/built-in/dashboard/dashboardRefreshScheduler.js';
import type { WidgetTypeRegistration } from '../../src/built-in/dashboard/dashboardTypes.js';

function makeType(category: 'static' | 'query' | 'ai'): WidgetTypeRegistration<Record<string, unknown>> {
  return {
    typeId: `parallx.dashboard.test-${category}`,
    displayName: 'Test',
    category,
    defaultSize: { colSpan: 4, rowSpan: 3 },
    defaultConfig: {},
    createWidget: () => ({ dispose() { /* noop */ } }),
  };
}

/** A controllable async gate: resolve it from the outside. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('DashboardRefreshScheduler — AI admission (M86 C4)', () => {
  it('caps concurrent AI refreshes at the live getter value and queues the rest FIFO', async () => {
    const scheduler = new DashboardRefreshScheduler(() => 2);
    const aiType = makeType('ai');

    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `w${i}`;
      scheduler.schedule(id, aiType, { kind: 'manual' }, async () => { /* unused */ });
      promises.push(scheduler.runOnce(id, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        order.push(i);
        await gates[i].promise;
        running--;
      }));
    }

    await tick();
    expect(maxRunning).toBe(2);
    expect(order).toEqual([0, 1]);

    gates[0].resolve();
    await tick();
    expect(order).toEqual([0, 1, 2]);

    gates[1].resolve(); gates[2].resolve(); gates[3].resolve();
    await Promise.all(promises);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(maxRunning).toBe(2);
    scheduler.dispose();
  });

  it('reads the cap live — raising the setting drains more of the queue', async () => {
    let cap = 1;
    const scheduler = new DashboardRefreshScheduler(() => cap);
    const aiType = makeType('ai');

    const gates = [deferred(), deferred(), deferred()];
    let maxRunning = 0;
    let running = 0;

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `w${i}`;
      scheduler.schedule(id, aiType, { kind: 'manual' }, async () => { /* unused */ });
      promises.push(scheduler.runOnce(id, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await gates[i].promise;
        running--;
      }));
    }
    await tick();
    expect(maxRunning).toBe(1);

    // User raises the setting mid-run; the next drain admits two at once.
    cap = 3;
    gates[0].resolve();
    await tick();
    expect(running).toBe(2);

    gates[1].resolve(); gates[2].resolve();
    await Promise.all(promises);
    scheduler.dispose();
  });

  it('clamps a bogus cap into 1-8', async () => {
    const scheduler = new DashboardRefreshScheduler(() => 0);
    const aiType = makeType('ai');
    const gate = deferred();
    let started = 0;

    scheduler.schedule('a', aiType, { kind: 'manual' }, async () => { /* unused */ });
    const p = scheduler.runOnce('a', async () => { started++; await gate.promise; });
    await tick();
    expect(started).toBe(1); // clamped to ≥ 1, so it still runs
    gate.resolve();
    await p;
    scheduler.dispose();
  });

  it('non-AI refreshes run in parallel, unaffected by the AI cap', async () => {
    const scheduler = new DashboardRefreshScheduler(() => 1);
    const queryType = makeType('query');

    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let maxRunning = 0;

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `q${i}`;
      scheduler.schedule(id, queryType, { kind: 'manual' }, async () => { /* unused */ });
      promises.push(scheduler.runOnce(id, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await gates[i].promise;
        running--;
      }));
    }
    await tick();
    expect(maxRunning).toBe(3);
    for (const g of gates) g.resolve();
    await Promise.all(promises);
    scheduler.dispose();
  });

  it('single-flight: overlapping runOnce for the same instance shares one invoke', async () => {
    const scheduler = new DashboardRefreshScheduler(() => 2);
    const aiType = makeType('ai');
    const gate = deferred();
    let invokes = 0;

    scheduler.schedule('one', aiType, { kind: 'manual' }, async () => { /* unused */ });
    const invoke = async () => { invokes++; await gate.promise; };
    // runOnce is async, so promise identity can't be asserted — the
    // guarantee is that overlapping calls share ONE underlying invoke.
    const p1 = scheduler.runOnce('one', invoke);
    const p2 = scheduler.runOnce('one', invoke);
    gate.resolve();
    await Promise.all([p1, p2]);
    expect(invokes).toBe(1);
    scheduler.dispose();
  });
});
