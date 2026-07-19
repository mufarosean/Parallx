// heartbeatTriggers.test.ts — M87 S1 acceptance: the deterministic trigger
// engine (docs/Parallx_Milestone_87.md §4, UC1–UC3 + invariants).
// Pure functions, zero model calls, zero DOM.

import { describe, expect, it } from 'vitest';
import {
  buildPlanFacts,
  evaluateTriggers,
  DEFAULT_TRIGGER_CONFIG,
  type IHeartbeatFacts,
  type IHeartbeatLedger,
} from '../../src/openclaw/heartbeatTriggers';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 19, 12, 0, 0).getTime();

function facts(partial: Partial<IHeartbeatFacts>): IHeartbeatFacts {
  return { plans: [], tasks: [], ...partial };
}

function task(over: Partial<IHeartbeatFacts['tasks'][number]>): IHeartbeatFacts['tasks'][number] {
  return { id: 't1', title: 'Task', status: 'planned', dueAt: null, createdAt: NOW - DAY, ...over };
}

// ─── buildPlanFacts (the plan sense) ─────────────────────────────────────────

describe('buildPlanFacts', () => {
  it('maps sessions with plans and drops sessions without', () => {
    const out = buildPlanFacts([
      { sessionId: 's1' },
      { sessionId: 's2', plan: { goal: 'Study ch. 7', steps: [{ text: 'read', status: 'done' }, { text: 'exercises', status: 'active' }], updatedAt: 123 } },
    ]);
    expect(out).toEqual([
      { sessionId: 's2', goal: 'Study ch. 7', activeStep: 'exercises', updatedAt: 123 },
    ]);
  });

  it('reports null activeStep when no step is active', () => {
    const out = buildPlanFacts([
      { sessionId: 's1', plan: { goal: 'G', steps: [{ text: 'a', status: 'done' }], updatedAt: 5 } },
    ]);
    expect(out[0].activeStep).toBeNull();
  });
});

// ─── UC1: stalled plan ───────────────────────────────────────────────────────

describe('UC1 — stalled plan nudge', () => {
  const stalledPlan = { sessionId: 's1', goal: 'Ship M87', activeStep: 'write tests', updatedAt: NOW - 5 * DAY };

  it('fires a task-shaped finding when an active step is older than stallDays', () => {
    const r = evaluateTriggers(facts({ plans: [stalledPlan] }), {}, NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      key: 'stalled-plan:s1',
      kind: 'stalled-plan',
      delivery: 'task',
    });
    expect(r.findings[0].title).toContain('Ship M87');
    expect(r.findings[0].detail).toContain('write tests');
  });

  it('stays quiet inside the stall window', () => {
    const fresh = { ...stalledPlan, updatedAt: NOW - 3 * DAY };
    const r = evaluateTriggers(facts({ plans: [fresh] }), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });

  it('ignores plans with no active step and plans with unknown age', () => {
    const done = { sessionId: 'a', goal: 'G', activeStep: null, updatedAt: NOW - 30 * DAY };
    const ageless = { sessionId: 'b', goal: 'G', activeStep: 'x', updatedAt: 0 };
    const r = evaluateTriggers(facts({ plans: [done, ageless] }), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });

  it('respects the configured threshold', () => {
    const r = evaluateTriggers(
      facts({ plans: [{ ...stalledPlan, updatedAt: NOW - 3 * DAY }] }),
      {}, NOW, { ...DEFAULT_TRIGGER_CONFIG, stallDays: 2 },
    );
    expect(r.findings).toHaveLength(1);
  });
});

// ─── UC2: review-queue triage ────────────────────────────────────────────────

describe('UC2 — review-queue triage', () => {
  function reviewing(n: number, oldestAgeDays: number) {
    return Array.from({ length: n }, (_, i) => task({
      id: `r${i}`,
      title: `Captured ${i}`,
      status: 'reviewing',
      createdAt: i === 0 ? NOW - oldestAgeDays * DAY : NOW - DAY,
    }));
  }

  it('fires ONE notification when the queue is big AND the oldest has aged', () => {
    const r = evaluateTriggers(facts({ tasks: reviewing(5, 4) }), {}, NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ key: 'review-queue', kind: 'review-queue', delivery: 'notification' });
    expect(r.findings[0].title).toContain('5');
    expect(r.findings[0].detail).toContain('Captured 0');
  });

  it('stays quiet below the size threshold', () => {
    const r = evaluateTriggers(facts({ tasks: reviewing(4, 10) }), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });

  it('stays quiet when the queue is big but young', () => {
    const r = evaluateTriggers(facts({ tasks: reviewing(6, 1) }), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });
});

// ─── UC3: overdue follow-up (the water-leak loop) ────────────────────────────

describe('UC3 — overdue follow-up', () => {
  it('fires a task-shaped follow-up for a planned task > overdueDays past due', () => {
    const overdue = task({ id: 'leak', title: 'Call plumber about the leak', dueAt: NOW - 2 * DAY });
    const r = evaluateTriggers(facts({ tasks: [overdue] }), {}, NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ key: 'overdue-task:leak', kind: 'overdue-task', delivery: 'task' });
    expect(r.findings[0].title).toBe('Follow up: Call plumber about the leak');
  });

  it('resolves silently: done/cancelled/reviewing tasks never fire', () => {
    const r = evaluateTriggers(facts({ tasks: [
      task({ id: 'a', status: 'done', dueAt: NOW - 5 * DAY }),
      task({ id: 'b', status: 'cancelled', dueAt: NOW - 5 * DAY }),
      task({ id: 'c', status: 'reviewing', dueAt: NOW - 5 * DAY }),
    ]}), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });

  it('stays quiet inside the overdue window and for undated tasks', () => {
    const r = evaluateTriggers(facts({ tasks: [
      task({ id: 'a', dueAt: NOW - DAY / 2 }),
      task({ id: 'b', dueAt: null }),
    ]}), {}, NOW);
    expect(r.findings).toHaveLength(0);
  });
});

// ─── Invariants: cooldowns, ledger, quiet days ───────────────────────────────

describe('cooldowns and ledger', () => {
  const overdue = task({ id: 'leak', title: 'Leak', dueAt: NOW - 2 * DAY });

  it('zero facts ⇒ zero findings (a quiet day stays quiet)', () => {
    const r = evaluateTriggers(facts({}), {}, NOW);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toBe(0);
  });

  it('a key inside its cooldown is suppressed and counted', () => {
    const ledger: IHeartbeatLedger = { 'overdue-task:leak': NOW - DAY };
    const r = evaluateTriggers(facts({ tasks: [overdue] }), ledger, NOW);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toBe(1);
  });

  it('the same key fires again after its cooldown expires', () => {
    const ledger: IHeartbeatLedger = { 'overdue-task:leak': NOW - 4 * DAY };
    const r = evaluateTriggers(facts({ tasks: [overdue] }), ledger, NOW);
    expect(r.findings).toHaveLength(1);
  });

  it('the returned ledger is pruned but NOT stamped for new findings', () => {
    const ledger: IHeartbeatLedger = {
      ancient: NOW - 90 * DAY,       // pruned (retention)
      recent: NOW - DAY,             // kept
    };
    const r = evaluateTriggers(facts({ tasks: [overdue] }), ledger, NOW);
    expect(r.ledger).toEqual({ recent: NOW - DAY });
    expect(r.ledger['overdue-task:leak']).toBeUndefined();
  });

  it('is pure: same inputs give identical outputs', () => {
    const f = facts({ tasks: [overdue] });
    const a = evaluateTriggers(f, {}, NOW);
    const b = evaluateTriggers(f, {}, NOW);
    expect(a).toEqual(b);
  });
});
