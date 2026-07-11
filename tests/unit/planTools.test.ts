// Unit tests for planTools.ts — M85 (the planning organ)

import { describe, it, expect } from 'vitest';
import {
  createPlanUpdateTool,
  formatSessionPlan,
  PLAN_MAX_STEPS,
  PLAN_MAX_STEP_CHARS,
  PLAN_MAX_GOAL_CHARS,
  PLAN_MAX_NOTE_CHARS,
} from '../../src/built-in/chat/tools/planTools';
import type { IPlanToolHost } from '../../src/built-in/chat/tools/planTools';
import type { IChatSessionPlan, ICancellationToken } from '../../src/services/chatTypes';

const token = { isCancellationRequested: false } as ICancellationToken;

function createHost(): IPlanToolHost & { plans: Map<string, IChatSessionPlan | undefined> } {
  const plans = new Map<string, IChatSessionPlan | undefined>();
  return {
    plans,
    readPlan: (sid) => plans.get(sid),
    writePlan: (sid, plan) => { plans.set(sid, plan); },
  };
}

describe('plan_update tool', () => {
  it('creates a plan with goal, steps, and note', async () => {
    const host = createHost();
    const tool = createPlanUpdateTool(host);
    const result = await tool.handler({
      goal: 'Ship the agency milestone',
      steps: [
        { text: 'Research the pipeline', status: 'done' },
        { text: 'Build the plan tool', status: 'active' },
        { text: 'Wire the UI', status: 'pending' },
      ],
      note: 'Building the tool now; UI next.',
    }, token, { sessionId: 's1' });

    expect(result.isError).toBeFalsy();
    const plan = host.plans.get('s1')!;
    expect(plan.goal).toBe('Ship the agency milestone');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1].status).toBe('active');
    expect(plan.note).toBe('Building the tool now; UI next.');
    // The result echoes the stored plan (verification material).
    expect(result.content).toContain('[x] Research the pipeline');
    expect(result.content).toContain('[>] Build the plan tool');
    expect(result.content).toContain('[ ] Wire the UI');
  });

  it('requires a goal on first call', async () => {
    const tool = createPlanUpdateTool(createHost());
    const result = await tool.handler({ steps: [{ text: 'a', status: 'pending' }] }, token, { sessionId: 's1' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('goal is required');
  });

  it('partial updates keep omitted fields', async () => {
    const host = createHost();
    const tool = createPlanUpdateTool(host);
    await tool.handler({ goal: 'G', steps: [{ text: 'a', status: 'pending' }], note: 'n' }, token, { sessionId: 's1' });
    // Update only steps — goal and note must survive.
    await tool.handler({ steps: [{ text: 'a', status: 'done' }] }, token, { sessionId: 's1' });
    const plan = host.plans.get('s1')!;
    expect(plan.goal).toBe('G');
    expect(plan.note).toBe('n');
    expect(plan.steps[0].status).toBe('done');
  });

  it('enforces the caps (steps count, step/goal/note length)', async () => {
    const host = createHost();
    const tool = createPlanUpdateTool(host);

    const tooManySteps = Array.from({ length: PLAN_MAX_STEPS + 1 }, (_, i) => ({ text: `s${i}`, status: 'pending' }));
    const r1 = await tool.handler({ goal: 'G', steps: tooManySteps }, token, { sessionId: 's1' });
    expect(r1.isError).toBe(true);
    expect(r1.content).toContain('capped');

    const r2 = await tool.handler({ goal: 'G', steps: [{ text: 'x'.repeat(PLAN_MAX_STEP_CHARS + 1), status: 'pending' }] }, token, { sessionId: 's1' });
    expect(r2.isError).toBe(true);

    const r3 = await tool.handler({ goal: 'g'.repeat(PLAN_MAX_GOAL_CHARS + 1) }, token, { sessionId: 's1' });
    expect(r3.isError).toBe(true);

    const r4 = await tool.handler({ goal: 'G', note: 'n'.repeat(PLAN_MAX_NOTE_CHARS + 1) }, token, { sessionId: 's1' });
    expect(r4.isError).toBe(true);

    // None of the failed calls should have written a plan.
    expect(host.plans.get('s1')).toBeUndefined();
  });

  it('rejects invalid statuses and empty step text', async () => {
    const tool = createPlanUpdateTool(createHost());
    const r1 = await tool.handler({ goal: 'G', steps: [{ text: 'a', status: 'doing' }] }, token, { sessionId: 's1' });
    expect(r1.isError).toBe(true);
    const r2 = await tool.handler({ goal: 'G', steps: [{ text: '', status: 'pending' }] }, token, { sessionId: 's1' });
    expect(r2.isError).toBe(true);
  });

  it('clear removes the plan', async () => {
    const host = createHost();
    const tool = createPlanUpdateTool(host);
    await tool.handler({ goal: 'G' }, token, { sessionId: 's1' });
    expect(host.plans.get('s1')).toBeDefined();
    const result = await tool.handler({ clear: true }, token, { sessionId: 's1' });
    expect(result.isError).toBeFalsy();
    expect(host.plans.get('s1')).toBeUndefined();
  });

  it('fails without a session context', async () => {
    const tool = createPlanUpdateTool(createHost());
    const result = await tool.handler({ goal: 'G' }, token);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('session');
  });

  it('is always-allowed and never requires confirmation', () => {
    const tool = createPlanUpdateTool(createHost());
    expect(tool.permissionLevel).toBe('always-allowed');
    expect(tool.requiresConfirmation).toBe(false);
  });
});

describe('formatSessionPlan', () => {
  it('renders goal, markers, and note', () => {
    const text = formatSessionPlan({
      goal: 'G',
      steps: [
        { text: 'one', status: 'done' },
        { text: 'two', status: 'active' },
        { text: 'three', status: 'pending' },
      ],
      note: 'next: two',
      updatedAt: 1,
    });
    expect(text).toBe('Goal: G\nSteps:\n[x] one\n[>] two\n[ ] three\nNow: next: two');
  });

  it('omits empty sections', () => {
    const text = formatSessionPlan({ goal: 'G', steps: [], updatedAt: 1 });
    expect(text).toBe('Goal: G');
  });
});
